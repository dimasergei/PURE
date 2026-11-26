'use strict';

const COINBASE_ENDPOINT = 'https://api.exchange.coinbase.com/products/ETH-USD/ticker';
const KRAKEN_PAIR = 'XETHZUSD';
const KRAKEN_TRADE_COUNT = 3;
const KRAKEN_ENDPOINT = `https://api.kraken.com/0/public/Trades?pair=${KRAKEN_PAIR}&count=${KRAKEN_TRADE_COUNT}`;
const NATIVE_ETH_RATE_MAX_AGE_MS = 30_000;
const NATIVE_ETH_RATE_FUTURE_SKEW_MS = 2_000;
const NATIVE_ETH_RATE_MAX_DIFFERENCE_BPS = 75;
const MIN_RATE_MICRO_USD = 1_000_000n;
const MAX_RATE_MICRO_USD = 1_000_000_000_000n;
const MAX_USD_CENTS = 2_147_483_647n;
const MICRO_USD_PER_USD = 1_000_000n;
const WEI_PER_ETH = 10n ** 18n;
const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_BODY_BYTES = 8_192;
const FETCH_TIMEOUT_MS = 4_000;

function unavailable() {
  return Object.assign(new Error('The ETH quote is temporarily unavailable. Please try again.'), {status: 503});
}

function parsePrice(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(value)) throw unavailable();
  const [whole, fraction = ''] = value.split('.');
  const micros = BigInt(whole) * MICRO_USD_PER_USD + BigInt(fraction.padEnd(6, '0'));
  if (micros < MIN_RATE_MICRO_USD || micros > MAX_RATE_MICRO_USD) throw unavailable();
  return micros;
}

function coinbaseTrade(body) {
  const time = body?.time;
  if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(time)) throw unavailable();
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== time.slice(0, 19)) throw unavailable();
  return {source: 'coinbase-exchange', rate: parsePrice(body.price), timestamp};
}

function krakenTrade(body) {
  const trades = body?.result?.[KRAKEN_PAIR];
  if (!Array.isArray(body?.error) || body.error.length || !Array.isArray(trades) || trades.length < 1 || trades.length > KRAKEN_TRADE_COUNT) {
    throw unavailable();
  }
  let latest;
  for (const trade of trades) {
    if (!Array.isArray(trade) || typeof trade[2] !== 'number' || !Number.isFinite(trade[2]) || trade[2] <= 0) throw unavailable();
    const timestamp = Math.floor(trade[2] * 1000);
    if (!Number.isSafeInteger(timestamp) || timestamp > MAX_DATE_TIMESTAMP_MS) throw unavailable();
    const rate = parsePrice(trade[0]);
    // Compare the provider's submillisecond timestamps before dropping precision.
    // If several trades share a timestamp, the last trade in the response wins.
    if (!latest || trade[2] >= latest.seconds) latest = {source: 'kraken', rate, timestamp, seconds: trade[2]};
  }
  return latest;
}

async function providerJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/json'}, signal
  });
  const declared = response?.headers?.get('content-length');
  if (!response?.ok || (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES))) {
    void response?.body?.cancel().catch(() => {});
    throw unavailable();
  }

  const reader = response.body?.getReader?.();
  if (!reader) throw unavailable();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw unavailable();
      chunks.push(Buffer.from(value));
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

async function loadNativeEthRate({fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  if (typeof fetchImpl !== 'function') throw unavailable();
  let trades;
  try {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const [coinbase, kraken] = await Promise.all([
      providerJson(fetchImpl, COINBASE_ENDPOINT, signal), providerJson(fetchImpl, KRAKEN_ENDPOINT, signal)
    ]);
    trades = [coinbaseTrade(coinbase), krakenTrade(kraken)];
  } catch {
    throw unavailable();
  }

  const clockValue = typeof now === 'function' ? now() : now;
  const fetched = clockValue instanceof Date ? clockValue.getTime() : clockValue;
  if (!Number.isSafeInteger(fetched) || fetched < 0 || fetched > MAX_DATE_TIMESTAMP_MS) throw unavailable();
  if (trades.some(trade => fetched - trade.timestamp > NATIVE_ETH_RATE_MAX_AGE_MS || trade.timestamp - fetched > NATIVE_ETH_RATE_FUTURE_SKEW_MS)) {
    throw unavailable();
  }

  const [coinbase, kraken] = trades;
  const [lower, higher] = coinbase.rate <= kraken.rate ? [coinbase.rate, kraken.rate] : [kraken.rate, coinbase.rate];
  if ((higher - lower) * 10_000n > lower * BigInt(NATIVE_ETH_RATE_MAX_DIFFERENCE_BPS)) throw unavailable();

  // Persist the reference price and both independently sourced trades for audit.
  return {
    microUsdPerEth: ((lower + higher) / 2n).toString(),
    observedAt: new Date(Math.min(coinbase.timestamp, kraken.timestamp)).toISOString(),
    fetchedAt: new Date(fetched).toISOString(),
    observations: trades.map(trade => ({
      source: trade.source, microUsdPerEth: trade.rate.toString(), observedAt: new Date(trade.timestamp).toISOString()
    }))
  };
}

function unsignedInteger(value, max, name) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = BigInt(value);
  if (typeof value === 'string' && value.length <= max.toString().length && /^(?:0|[1-9]\d*)$/.test(value)) value = BigInt(value);
  if (typeof value !== 'bigint' || value < 1n || value > max) throw new RangeError(`Invalid ${name}.`);
  return value;
}

function nativeEthWeiForUsdCents(usdCents, microUsdPerEth) {
  const cents = unsignedInteger(usdCents, MAX_USD_CENTS, 'USD cents');
  const rate = unsignedInteger(microUsdPerEth, MAX_RATE_MICRO_USD, 'ETH/USD rate');
  if (rate < MIN_RATE_MICRO_USD) throw new RangeError('Invalid ETH/USD rate.');
  const numerator = cents * (MICRO_USD_PER_USD / 100n) * WEI_PER_ETH;
  return ((numerator + rate - 1n) / rate).toString();
}

module.exports = {
  loadNativeEthRate, nativeEthWeiForUsdCents,
  NATIVE_ETH_RATE_MAX_AGE_MS, NATIVE_ETH_RATE_FUTURE_SKEW_MS, NATIVE_ETH_RATE_MAX_DIFFERENCE_BPS
};

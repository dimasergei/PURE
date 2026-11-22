'use strict';

function dispatchCutoff(env = process.env) {
  const time = env.PURE_DISPATCH_CUTOFF || '';
  const zone = env.PURE_DISPATCH_TIME_ZONE || '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !zone) return null;
  try {
    const label = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
    }).format(new Date('2000-01-01T' + time + ':00Z'));
    const timeZone = new Intl.DateTimeFormat('en-US', {timeZone: zone}).resolvedOptions().timeZone;
    return { time: label, time_zone: timeZone };
  } catch {
    return null;
  }
}
module.exports = { dispatchCutoff };

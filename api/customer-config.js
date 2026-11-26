'use strict';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const url=new URL(req.url||'/api/customer-config','https://account.internal');
 if(['shop','coas'].includes(url.searchParams.get('catalog_view')))return require('../lib/public-catalog-view.cjs').handle(req,res,url.searchParams);
 if(url.searchParams.has('commerce_form'))return require('../lib/commerce-form').handle(req,res,url.searchParams.get('commerce_form'));
 if(url.searchParams.has('age_gate'))return require('../lib/age-consent').handle(req,res,url.searchParams);
 if(url.searchParams.has('gift_order'))return require('../lib/gift-orders').handle(req,res,url.searchParams.get('gift_order'));
 if(url.searchParams.get('gift_card')==='request')return require('../lib/gift-card-inquiry').handle(req,res);
 if(url.searchParams.has('repeat_orders'))return require('../lib/repeat-orders').handle(req,res);
 if(url.searchParams.has('spin_save'))return require('../lib/spin-save').handle(req,res);
 if(url.searchParams.get('track_order')==='request')return require('../lib/track-order').handle(req,res);
 if(url.searchParams.has('display_locale'))return require('../lib/display-locale').handle(req,res,url.searchParams);
 if(url.searchParams.has('admin_auth'))return require('../lib/admin-auth').handle(req,res);
 if(url.searchParams.has('inventory'))return require('../lib/standalone-inventory').handle(req,res);
 if(url.searchParams.has('research_builder'))return require('../lib/research-builder-handler')(req,res);
 if(url.searchParams.has('lotus'))return require('../lib/lotus-admin').handle(req,res,url.searchParams);
 if(url.searchParams.has('dispatch')){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  return res.status(200).json({cutoff:require('../lib/dispatch-cutoff').dispatchCutoff()});
 }
 if(url.searchParams.get('campaign')==='newsletter')return require('../lib/newsletter-form').handle(req,res);
 if(url.searchParams.has('campaign')){
  if(req.method==='POST'&&url.searchParams.get('campaign')==='signup')return require('../lib/campaign-signup').handle(req,res);
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  try {
   return res.status(200).json({...require('../lib/campaign-window').checkoutCampaign(),
    second_unit:await require('../lib/second-unit-offer').available()});
  } catch {return res.status(503).json({error:'Offers are temporarily unavailable.'});}
 }
 if(url.searchParams.has('reviews')){
  if(req.method==='POST')return require('../lib/review-credit').handle(req,res);
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  try{
   const {data,error}=await require('../lib/inventory-db').inventoryDb().rpc('commerce_storefront_review_summary');
   if(error||!data)throw Error('Review summary unavailable.');
   res.setHeader('Cache-Control','public, max-age=60');
   return res.status(200).json(data);
  }catch{return res.status(503).json({error:'Review summary unavailable.'});}
 }
 if(url.searchParams.has('partner'))return require('../lib/partner-program').handle(req,res,url.searchParams);
 if(url.searchParams.get('instagram')==='callback')return require('../lib/admin-marketing-platform').oauthCallback(req,res);
 if(url.searchParams.has('marketing'))return require('../lib/admin-marketing')(req,res);
 if(url.searchParams.has('mobile_funnel'))return require('../lib/mobile-funnel').handle(req,res,url.searchParams.get('mobile_funnel'));
 if(url.searchParams.has('guest_interac'))return require('../lib/guest-interac').handle(req,res,url.searchParams.get('guest_interac'));
 if(url.searchParams.has('checkout'))return require('../lib/direct-checkout').handle(req,res,url.searchParams);
 if(url.searchParams.has('commerce'))return require('../lib/manual-commerce-integrated').handle(req,res,url.searchParams);
 if(url.searchParams.has('admin_operations'))return require('../lib/admin-operations').handle(req,res,url.searchParams);
 if(req.method==='GET'&&url.searchParams.get('workspace')==='requests'){
  try{return await require('../lib/request-operations').customerRequests(req,res,require('../lib/inventory-db').inventoryDb());}
  catch(e){return res.status([400,401].includes(e.status)?e.status:503).json({error:e.status===400?e.message:'Requests are temporarily unavailable.'});}
 }
 if(req.method==='POST')return require('../lib/site-inquiry').handleInquiry(req,res);
 if(req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).end();}
 const supabaseUrl=process.env.SUPABASE_URL||'',anonKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)||!anonKey)return res.status(503).json({error:'Customer accounts are not configured.'});
 return res.status(200).json({supabaseUrl,anonKey});
};

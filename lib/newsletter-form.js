'use strict';
// Native HTML form adapter for the existing consent, validation and rate-limited signup service.
async function handle(req,res) {
  if(req.method!=='POST')return res.status(405).end();
  if(String(req.headers['content-type'] || '').split(';')[0]!=='application/x-www-form-urlencoded')return res.status(415).end();
  const body=typeof req.body==='string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
  const {site}=require('./public-site.cjs');
  const {handle:signup}=require('./campaign-signup');
  const adapter={
    status(code){this.code=code;return this;},
    json(){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag','noindex');
      const title=this.code===200?'You’re subscribed to PURE emails.':'Your subscription could not be completed.';
      const detail=this.code===200?'You can now return to the research catalog.':'Check your email address and consent, or contact '+site.support.email+'.';
      return res.status(this.code).send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PURE email updates</title><main><h1>'+title+'</h1><p>'+detail+'</p><p><a href="/">Home</a> · <a href="/shop">Shop compounds</a></p></main></html>');
    }
  };
  return signup({...req,headers:{...req.headers,'content-type':'application/json'},body:{email:body?.email,consent:body?.consent==='on'}},adapter);
}
module.exports={handle};

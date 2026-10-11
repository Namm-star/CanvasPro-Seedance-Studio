import {readFileSync} from 'node:fs';
export const catalog=JSON.parse(readFileSync(new URL('../data/catalog.json',import.meta.url)));
// Public retail-price fixture only; the client repository needs no private
// upstream release plans, channel configuration or production credentials.
const prices=JSON.parse(readFileSync(new URL('./pricing.json',import.meta.url)));
export function mockSite({postDelay=0,failedSubmit=false,priceDrift=false,missingModels=[],badTaskId=false}={}){
  const calls=[];let polls=0;
  const fetchImpl=async(url,options={})=>{
    calls.push({path:new URL(url).pathname,method:options.method||'GET',headers:{...options.headers},body:options.body});
    const path=new URL(url).pathname,response=(j,status=200,headers={})=>new Response(typeof j==='string'?j:JSON.stringify(j),{status,headers:{'Content-Type':'application/json',...headers}});
    if(path==='/v1/models')return response({data:catalog.models.filter(m=>!missingModels.includes(m.model)).map(m=>({id:m.model}))});
    if(path==='/api/pricing')return response({success:true,data:prices.pricing.map(p=>({model_name:p.model_name,billing_mode:'tiered_expr',billing_expr:p.values['billing_setting.billing_expr']+(priceDrift?' ':'') ,supported_endpoint_types:['openai','suanli-seedance-submit','suanli-seedance-query']}))});
    if(path==='/api/status')return response({success:true,data:{quota_display_type:'CUSTOM',custom_currency_exchange_rate:6.7743}});
    if(path==='/client/seedance/catalog.json')return response(catalog);
    if(path==='/suanli/v1/videos'&&options.method==='POST'){
      if(postDelay)await new Promise(r=>setTimeout(r,postDelay));if(failedSubmit)throw Error('PRIVATE KEY SHOULD NOT LEAK '+options.headers.Authorization);
      return response({id:badTaskId?'https://evil.example/key':'task_mock_demo',status:'queued'});
    }
    if(path==='/suanli/v1/videos/task_mock_demo')return response({id:'task_mock_demo',status:++polls<2?'in_progress':'completed'});
    if(path==='/v1/tasks/task_mock_demo/artifacts/video/content')return new Response(new Uint8Array([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]),{status:options.headers.Range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':'16',...(options.headers.Range?{'Content-Range':'bytes 0-15/16'}:{})}});
    throw Error('Unexpected mock path');
  };return {fetchImpl,calls};
}

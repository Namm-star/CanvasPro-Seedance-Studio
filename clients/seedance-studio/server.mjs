import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {API_ORIGIN,MAX_BODY,ClientError,ensure,validateBody,validateCatalog,estimateCny,safeTaskId} from './lib/contracts.mjs';
export const VERSION='0.1.3';
const directory=dirname(fileURLToPath(import.meta.url)),hash=x=>createHash('sha256').update(x).digest('hex');
const safeError=e=>e instanceof ClientError?e.message:'连接暂时不可用，请检查网络或密钥；没有自动重新提交。';
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
export function createStudio({fetchImpl=fetch,storage=null,catalogFixture=null}={}){
  const token=randomBytes(32).toString('hex');let key='',owner='',catalog=null,connected=false,submitting=false,connecting=false,lastActive=Date.now(),origin='';
  let history=[];const quotes=new Map();
  if(storage){mkdirSync(storage,{recursive:true});try{history=JSON.parse(readFileSync(join(storage,'history.json')));ensure(Array.isArray(history),'历史格式错误');history=history.slice(-500);for(const j of history)if(j.state==='submitting'){j.state='unknown';j.message='上次提交中断，先在本站日志核对，不要重新提交';}}catch{history=[];}}
  const persist=()=>{if(storage){const file=join(storage,'history.json');writeFileSync(file+'.tmp',JSON.stringify(history.slice(-500)),{mode:0o600});renameSync(file+'.tmp',file);}};
  const ownedJobs=()=>history.filter(j=>j.owner===owner).map(({owner,...j})=>j);
  const site=async(path,options={})=>{
    ensure(path.startsWith('/')&&!path.startsWith('//'),'请求路径无效');
    const {timeoutMs,...requestOptions}=options;
    const r=await fetchImpl(API_ORIGIN+path,{...requestOptions,headers:{...options.headers,...(key?{Authorization:'Bearer '+key}:{})},redirect:'error',signal:AbortSignal.timeout(timeoutMs||(options.method==='POST'?120000:20000))});
    return r;
  };
  const json=async(r)=>{ensure(Number(r.headers.get('content-length')||0)<=2*1024*1024,'站点响应过大');const reader=r.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;ensure(size<=2*1024*1024,'站点响应过大');chunks.push(Buffer.from(value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ClientError('站点响应异常，请稍后刷新');}};
  const refresh=async()=>{
    ensure(key,'请先连接本站密钥');connected=false;
    const responses=await Promise.all([site('/v1/models'),site('/api/pricing'),catalogFixture?null:site('/client/seedance/catalog.json?refresh='+Date.now()),site('/api/status')]);
    ensure(responses.filter(Boolean).every(r=>r.ok),'连接失败：请检查本站Key权限、额度和网络');
    const [models,pricing,feed,status]=await Promise.all(responses.map(r=>r?json(r):catalogFixture));
    validateCatalog(feed);ensure(pricing.success&&Array.isArray(models.data)&&status.success,'站点目录暂不可用');
    const rate=Number(status.data?.custom_currency_exchange_rate);
    ensure(status.data?.quota_display_type==='CUSTOM'&&Math.abs(rate-Number(feed.creditsPerUsd))<1e-8,'积分换算已更新，请更新模型目录');
    const allowed=new Set(models.data.map(m=>m.id));
    const available=feed.models.filter(m=>{const p=pricing.data.find(p=>p.model_name===m.model);return allowed.has(m.model)&&p?.billing_mode==='tiered_expr'&&hash(p.billing_expr)===m.priceExpressionSHA256&&p.supported_endpoint_types.includes('suanli-seedance-submit')&&p.supported_endpoint_types.includes('suanli-seedance-query');});
    // An unavailable catalog must not prevent an existing paid task being
    // queried with its original valid Key. New quotes still require a model.
    catalog={...feed,models:available,checkedAt:new Date().toISOString(),excluded:feed.models.length-available.length};connected=true;return catalog;
  };
  const requestBody=async(req,limit=MAX_BODY+4096)=>{ensure(req.headers['content-type']?.startsWith('application/json'),'仅支持JSON请求');let length=0;const chunks=[];for await(const c of req){length+=c.length;if(length>limit)throw new ClientError('素材过大，请减少文件或使用公网链接',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ClientError('请求格式不正确');}};
  const getJob=id=>{const j=history.find(j=>j.localId===id&&j.owner===owner);ensure(j,'找不到此密钥对应的任务');return j;};
  const polling=new Map();
  const poll=async j=>{
    if(polling.has(j.localId))return polling.get(j.localId);
    const promise=(async()=>{ensure(key,'请重新连接原任务的密钥');safeTaskId(j.taskId);
      const r=await site('/suanli/v1/videos/'+encodeURIComponent(j.taskId));ensure(r.ok,'查询暂不可用，已保留任务号；不会重新提交');const b=await json(r);
      ensure(b.id===j.taskId,'任务响应不匹配');ensure(['queued','in_progress','completed','failed'].includes(b.status),'任务状态待确认，请保留任务号');
      j.state=b.status;j.updatedAt=new Date().toISOString();j.message=b.status==='failed'?'生成未完成。请在本站用量记录核对结算；需要再次生成时请新建任务。':'';persist();return j;
    })().finally(()=>polling.delete(j.localId));polling.set(j.localId,promise);return promise;
  };
  const server=http.createServer(async(req,res)=>{
    try{
      ensure(req.headers.host===new URL(origin).host,'不允许此访问来源');
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const u=new URL(req.url,origin),path=u.pathname;
      if(path==='/api/bootstrap'&&req.method==='POST'){
        ensure(req.headers.origin===origin&&req.headers['x-studio-token']===token,'会话初始化无效');
        res.setHeader('Set-Cookie',`studio=${token}; HttpOnly; SameSite=Strict; Path=/`);
        const preview=validateCatalog(catalogFixture||JSON.parse(readFileSync(join(directory,'data/catalog.json'))));
        return send(res,200,{ready:true,version:VERSION,preview});
      }
      if(path==='/health'&&req.headers['x-studio-token']===token)return send(res,200,{version:VERSION});
      if(path.startsWith('/api/')||path.startsWith('/media/')){
        const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('studio='))?.slice(7);
        ensure(cookie===token||req.headers['x-studio-token']===token,'本机会话已过期，请重新打开客户端');
        if(req.method!=='GET')ensure(req.headers.origin===origin&&req.headers['x-studio-token']===token,'此操作必须由客户端界面发起');
        ensure(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'拒绝跨站请求');
        lastActive=Date.now();
      }
      if(path==='/api/session'&&req.method==='POST'){
        const b=await requestBody(req,4096);ensure(!submitting&&!connecting&&polling.size===0,'正在请求，请稍后切换密钥');ensure(typeof b.key==='string'&&b.key.trim().length>=12&&b.key.trim().length<512&&!/[\s\r\n]/.test(b.key.trim()),'请输入本站有效API Key');
        connecting=true;key=b.key.trim();owner=hash(key).slice(0,24);quotes.clear();try{await refresh();return send(res,200,{catalog,jobs:ownedJobs(),version:VERSION});}catch(e){key='';owner='';connected=false;throw e;}finally{connecting=false;}
      }
      if(path==='/api/catalog'&&req.method==='POST'){
        ensure(!submitting&&!connecting,'正在请求，请稍后刷新目录');connecting=true;
        try{return send(res,200,{catalog:await refresh(),jobs:ownedJobs()});}finally{connecting=false;}
      }
      if(path==='/api/ping')return send(res,200,{connected,version:VERSION});
      if(path==='/api/jobs'&&req.method==='GET')return send(res,200,{jobs:ownedJobs()});
      if(path==='/api/disconnect'&&req.method==='POST'){ensure(!submitting&&!connecting&&polling.size===0,'正在请求，请稍后断开');key='';owner='';connected=false;quotes.clear();return send(res,200,{disconnected:true});}
      if(path==='/api/quote'&&req.method==='POST'){
        ensure(connected,'请先连接密钥');const {body}=await requestBody(req);const m=catalog.models.find(m=>m.model===body?.model);ensure(m,'该型号暂不可用');validateBody(body,m);
        ensure(!history.some(j=>j.owner===owner&&['unknown','submitting'].includes(j.state)&&!j.acknowledged),'有结果待确认的提交，请先核对本站记录');
        const quoteId=randomBytes(20).toString('hex');quotes.set(quoteId,{bodyHash:hash(JSON.stringify(body)),amount:estimateCny(m,body),priceHash:m.priceExpressionSHA256,at:Date.now()});
        if(quotes.size>20)quotes.delete(quotes.keys().next().value);
        return send(res,200,{quoteId,amount:estimateCny(m,body),unit:'积分',standardGroup:true,expiresSeconds:60});
      }
      if(path==='/api/jobs'&&req.method==='POST'){
        const b=await requestBody(req),existing=history.find(j=>j.localId===b.submissionId&&j.owner===owner);if(existing)return send(res,200,{job:ownedJobs().find(j=>j.localId===existing.localId)});
        ensure(connected&&key,'请先连接密钥');ensure(!submitting,'正在提交，请勿重复点击');ensure(typeof b.submissionId==='string'&&/^[a-f0-9-]{36}$/.test(b.submissionId),'提交编号无效');
        ensure(!history.some(j=>j.owner===owner&&['unknown','submitting'].includes(j.state)&&!j.acknowledged),'先核对上一笔结果待确认的请求');
        const quote=quotes.get(b.quoteId);ensure(quote&&Date.now()-quote.at<60000&&quote.bodyHash===hash(JSON.stringify(b.body)),'报价已过期或参数改变，请重新确认');
        submitting=true;let job;
        try{
          await refresh();const m=catalog.models.find(m=>m.model===b.body?.model);ensure(m&&m.priceExpressionSHA256===quote.priceHash,'型号或价格已改变，请刷新');validateBody(b.body,m);quotes.delete(b.quoteId);
          job={owner,localId:b.submissionId,model:m.model,seconds:b.body.seconds,resolution:b.body.resolution,aspectRatio:b.body.aspect_ratio,estimatedCny:quote.amount,state:'submitting',createdAt:new Date().toISOString()};history.push(job);persist();
          try{const r=await site('/suanli/v1/videos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b.body)});const result=await json(r);
            // Even HTTP errors can follow a debit or accepted task. Never retry.
            ensure(r.ok,'未取得任务号，请在本站记录核对');job.taskId=safeTaskId(result.id);job.state=['queued','in_progress','completed','failed'].includes(result.status)?result.status:'queued';job.updatedAt=new Date().toISOString();persist();
          }catch{job.state='unknown';job.message='提交结果待确认，已禁止重复提交。请先在本站任务/用量记录核对。';persist();}
          return send(res,200,{job:ownedJobs().find(j=>j.localId===job.localId)});
        }finally{submitting=false;}
      }
      const action=/^\/api\/jobs\/([a-f0-9-]{36})\/(poll|acknowledge)$/.exec(path);
      if(action&&req.method==='POST'){const j=getJob(action[1]);if(action[2]==='acknowledge'){ensure(j.state==='unknown','该任务不需要人工核对');j.acknowledged=true;persist();return send(res,200,{jobs:ownedJobs()});}return send(res,200,{job:(({owner,...p})=>p)(await poll(j))});}
      const media=/^\/media\/([a-f0-9-]{36})$/.exec(path);
      if(media&&req.method==='GET'){
        const j=getJob(media[1]);ensure(j.state==='completed','任务尚未完成');safeTaskId(j.taskId);
        const headers={};if(req.headers.range){ensure(/^bytes=\d*-\d*$/.test(req.headers.range),'Range无效');headers.Range=req.headers.range;}
        const r=await site('/v1/tasks/'+encodeURIComponent(j.taskId)+'/artifacts/video/content',{headers,timeoutMs:180000});ensure([200,206].includes(r.status)&&r.headers.get('content-type')?.startsWith('video/mp4'),'视频暂不可下载，请稍后重试');
        const h={'Content-Type':'video/mp4','Cache-Control':'no-store','Accept-Ranges':'bytes'};for(const n of ['content-length','content-range'])if(r.headers.get(n))h[n]=r.headers.get(n);
        if(u.searchParams.get('download')==='1')h['Content-Disposition']='attachment; filename="seedance-'+j.taskId+'.mp4"';res.writeHead(r.status,h);await pipeline(Readable.fromWeb(r.body),res);return;
      }
      if(path==='/api/exit'&&req.method==='POST'){ensure(!submitting&&!connecting&&polling.size===0,'正在请求，暂不能退出');key='';send(res,200,{exiting:true});setTimeout(()=>server.closeAllConnections(),200);setTimeout(()=>server.close(),250);return;}
      const staticFiles={'/':['public/index.html','text/html; charset=utf-8'],'/app.js':['public/app.js','text/javascript; charset=utf-8'],'/style.css':['public/style.css','text/css; charset=utf-8'],'/contracts.mjs':['lib/contracts.mjs','text/javascript; charset=utf-8']};
      const file=staticFiles[path];ensure(file&&req.method==='GET','找不到页面');res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});res.end(readFileSync(join(directory,file[0])));
    }catch(e){if(res.headersSent)res.destroy();else send(res,e.status||400,{error:safeError(e)});}
  });
  // The unpredictable bootstrap fragment token never goes to production or
  // query logs. Keys and input media are never persisted.
  return {server,token,setOrigin(value){origin=value;},getOrigin(){return origin;},setCookieHeaders(res){res.setHeader('Set-Cookie',`studio=${token}; HttpOnly; SameSite=Strict; Path=/`);},get idleMilliseconds(){return Date.now()-lastActive;},get pending(){return submitting;},get connected(){return connected;}};
}
export async function startStudio(options={}){
  const studio=createStudio(options);
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));studio.setOrigin('http://127.0.0.1:'+studio.server.address().port);return studio;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const storage=join(process.env.LOCALAPPDATA||process.cwd(),'CanvasProSeedanceStudio');mkdirSync(storage,{recursive:true});const lock=join(storage,'instance.json');
  let reused=false;
  try{const old=JSON.parse(readFileSync(lock));const r=await fetch('http://127.0.0.1:'+old.port+'/health',{headers:{'X-Studio-Token':old.token},signal:AbortSignal.timeout(1000)});if(r.ok){console.log('http://127.0.0.1:'+old.port+'/#'+old.token);reused=true;}}catch{}
  if(!reused){const studio=await startStudio({storage});writeFileSync(lock,JSON.stringify({pid:process.pid,port:studio.server.address().port,token:studio.token}),{mode:0o600});console.log(studio.getOrigin()+'/#'+studio.token);
    const idle=setInterval(()=>{if(studio.idleMilliseconds>10*60*1000&&!studio.pending){studio.server.closeAllConnections();studio.server.close();}},30000);idle.unref();
    studio.server.on('close',()=>{try{const v=JSON.parse(readFileSync(lock));if(v.pid===process.pid)unlinkSync(lock);}catch{}process.exit(0);});
  }
}

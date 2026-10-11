export const API_ORIGIN = 'https://api.canvasproai.com';
export const MAX_BODY = 18 * 1024 * 1024;
export const MODE_LABELS = {none:'文生视频',images:'图片参考',videos:'视频参考','images+videos':'图片 + 视频','audios+images':'图片 + 音频','audios+images+videos':'全能参考'};
export const MIME = {images:['image/png','image/jpeg','image/webp'],videos:['video/mp4'],audios:['audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/ogg','audio/flac']};
export class ClientError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function ensure(value,message){if(!value)throw new ClientError(message);}
export function validateCatalog(c){
  ensure(c?.schemaVersion===1&&c.application==='canvaspro-seedance-studio'&&c.models?.length>0&&c.models.length<=1000,'模型目录版本不兼容，请更新客户端');
  ensure(new Set(c.models.map(x=>x.model)).size===c.models.length,'模型目录存在重复项');
  for(const m of c.models){
    ensure(typeof m.model==='string'&&m.model.length<=256&&['2.0','2.5','other'].includes(m.family)&&['per_request','per_second'].includes(m.billingMode),'模型目录格式无效');
    ensure(Number(m.saleCny)>0&&[1,1.75].includes(m.videoMultiplier)&&/^[a-f0-9]{64}$/.test(m.priceExpressionSHA256),'价格目录格式无效');
    ensure(m.variants?.length>0&&m.variants.length<=10,'模型缺少参数');
    for(const v of m.variants){
      ensure(['480p','720p','1080p','4k'].includes(v.resolution)&&v.seconds?.length>0&&v.seconds.every(s=>Number.isInteger(s)&&s>=4&&s<=30),'时长/清晰度目录无效');
      ensure(v.aspectRatios?.length>0&&v.aspectRatios.every(r=>['16:9','9:16','1:1','4:3','3:4','21:9'].includes(r)),'比例目录无效');
      ensure(v.referenceCombinations?.length>0&&v.referenceCombinations.every(x=>Object.hasOwn(MODE_LABELS,x)),'参考方式目录无效');
      ensure(Object.keys(MIME).every(f=>Number.isInteger(v.maxReferences?.[f])&&v.maxReferences[f]>=0&&v.maxReferences[f]<=30),'素材数量目录无效');
    }
  }return c;
}
export function variantsFor(m,resolution){return m.variants.filter(v=>v.resolution===resolution);}
export function selectionFor(m,current={}){
  const resolution=m.variants.some(v=>v.resolution===current.resolution)?current.resolution:m.variants[0].resolution;
  const variants=variantsFor(m,resolution),seconds=variants.some(v=>v.seconds.includes(current.seconds))?current.seconds:variants[0].seconds[0];
  const v=variants.find(v=>v.seconds.includes(seconds));
  return {resolution,seconds,aspect_ratio:v.aspectRatios.includes(current.aspect_ratio)?current.aspect_ratio:v.aspectRatios[0],mode:v.referenceCombinations.includes(current.mode)?current.mode:v.referenceCombinations[0]};
}
export function estimateCny(m,body){const premium=body.videos?.length?m.videoMultiplier:1;return Math.ceil(Number(m.saleCny)*(m.billingMode==='per_second'?body.seconds:1)*premium*10000-1e-8)/10000;}
// Reconcile without mutating or discarding the user's original draft.
export function reconcileMedia(model,selection,media){
  const v=model.variants.find(v=>v.resolution===selection.resolution&&v.seconds.includes(selection.seconds)&&v.aspectRatios.includes(selection.aspect_ratio));
  ensure(v&&v.referenceCombinations.includes(selection.mode),'参考方式不受支持');
  const kept={images:[],videos:[],audios:[]},removed=[];let total=0;
  for(const field of Object.keys(MIME))for(const item of media[field]||[]){
    const data=/^data:([^;,]+);base64,/.exec(item.value),types=field==='audios'&&v.audioMimes?v.audioMimes:MIME[field];
    let reason='';
    if(!selection.mode.split('+').includes(field))reason='新参考方式不支持';
    else if(data?!types.includes(data[1]):field==='audios'&&v.audioMimes)reason='新型号不支持此格式';
    else if(kept[field].length>=v.maxReferences[field])reason=`超过新上限${v.maxReferences[field]}个`;
    else if(v.referenceTotalMax&&total>=v.referenceTotalMax)reason=`超过参考合计上限${v.referenceTotalMax}个`;
    if(reason)removed.push({field,item,reason});else{kept[field].push(item);total++;}
  }
  return {kept,removed};
}
export function filterModels(models,filters={}){
  return models.filter(m=>(!filters.family||filters.family==='all'||m.family===filters.family)&&(!filters.search||m.model.toLowerCase().includes(filters.search.toLowerCase()))&&(!filters.billing||m.billingMode===filters.billing)&&m.variants.some(v=>(!filters.resolution||v.resolution===filters.resolution)&&(!filters.seconds||v.seconds.includes(Number(filters.seconds)))&&(!filters.mode||v.referenceCombinations.includes(filters.mode))));
}
export function validateBody(body,model){
  ensure(body&&typeof body==='object'&&!Array.isArray(body),'请求格式错误');
  ensure(Object.keys(body).every(f=>['model','prompt','seconds','resolution','aspect_ratio','images','videos','audios'].includes(f)),'包含未开放的参数');
  ensure(body.model===model.model,'请选择当前可用的模型');
  ensure(typeof body.prompt==='string'&&body.prompt.trim().length>0&&body.prompt.length<=20000,'请输入提示词（最多20000字符）');
  ensure(Number.isInteger(body.seconds),'时长必须从选项中选择');
  for(const field of Object.keys(MIME))ensure(body[field]===undefined||Array.isArray(body[field]),'参考素材必须是列表');
  const combo=Object.keys(MIME).filter(f=>body[f]?.length).sort().join('+')||'none';
  const variant=model.variants.find(v=>v.resolution===body.resolution&&v.seconds.includes(body.seconds)&&v.aspectRatios.includes(body.aspect_ratio)&&v.referenceCombinations.includes(combo)&&Object.keys(MIME).every(f=>(body[f]?.length||0)<=v.maxReferences[f]));
  ensure(variant,'这组参数或参考素材不受当前模型支持');
  ensure(!variant.referenceTotalMax||Object.keys(MIME).reduce((n,f)=>n+(body[f]?.length||0),0)<=variant.referenceTotalMax,`参考素材总数量超限（最多${variant.referenceTotalMax}个）`);
  for(const field of Object.keys(MIME))for(const value of body[field]||[]){
    ensure(typeof value==='string'&&value===value.trim(),'素材格式不正确');
    const data=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if(data){
      const types=field==='audios'&&variant.audioMimes?variant.audioMimes:MIME[field];
      ensure(types.includes(data[1])&&data[2].length%4===0,'素材格式不支持，请按页面格式要求上传');
      ensure(data[2].length*3/4<=50*1024*1024+2,'单文件超过50MiB');
    }else{
      ensure(!(field==='audios'&&variant.audioMimes),'此型号音频只接受本地MP3文件');
      ensure(isPublicMediaUrl(value),'仅支持公网图片/音频/视频链接（默认端口80/443）');
    }
  }
  ensure(new TextEncoder().encode(JSON.stringify(body)).length<=MAX_BODY,'素材合计过大：本地文件编码后请求最多18MiB，请减少素材或使用公网链接');
  return body;
}
export function safeTaskId(id){ensure(typeof id==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(id),'没有取得有效任务号，请核对本站记录，不要重新提交');return id;}
export function isPublicMediaUrl(value){
  const match=/^https?:\/\/([a-z0-9.-]+)(?::(?:80|443))?(?:[/?#]|$)/i.exec(value),host=match?.[1]?.toLowerCase();
  return typeof value==='string'&&value===value.trim()&&value.length<=8192&&!!host&&host.includes('.')&&!host.includes('..')&&!host.startsWith('.')&&!host.endsWith('.')&&!host.endsWith('.local')&&!host.endsWith('.localhost')&&!/^\d+\.\d+\.\d+\.\d+$/.test(host)&&!/[\s\\]/.test(value);
}

(()=>{var A="openchamber.sdk",O=1;var qe=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [data-oc-scrolling] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [data-oc-scrolling] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [data-oc-scrolling]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [data-oc-scrolling] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function qt(e){let o=e.documentElement;if(o.hasAttribute("data-oc-scrollbar-activity"))return;o.setAttribute("data-oc-scrollbar-activity","");let n=new WeakMap;e.addEventListener("scroll",(i)=>{let a=i.target===e?o:i.target;if(!(a instanceof Element))return;if(!a.hasAttribute("data-oc-scrolling"))a.setAttribute("data-oc-scrolling","");let c=n.get(a);if(c!==void 0)clearTimeout(c);n.set(a,setTimeout(()=>{n.delete(a),a.removeAttribute("data-oc-scrolling")},1000))},{capture:!0,passive:!0})}var sr=`(${qt.toString()})(document);`;var Ze=128,et=65536;var Ie=128;var Ce=65536;var oo=/^[a-z][a-z0-9-]{0,39}$/;var Zt=(e)=>Object(e)===e&&!Array.isArray(e),tt=(e,o)=>Object.keys(e).every((n)=>o.includes(n)),eo=(e)=>String(e)===e&&e.length>=1&&e.length<=60,to=(e)=>String(e)===e&&e.length>=1&&e.length<=80,ro=(e)=>{if(!Array.isArray(e)||e.length>4)return!1;let o=new Set;for(let n of e){if(!Zt(n)||!oo.test(n.id)||!eo(n.label))return!1;if(n.disabled!==void 0&&n.disabled!==!0&&n.disabled!==!1)return!1;if(o.has(n.id))return!1;if(o.add(n.id),n.kind==="button"){if(!tt(n,["kind","id","label","disabled"]))return!1;continue}if(n.kind!=="select"||!tt(n,["kind","id","label","value","options","disabled"]))return!1;if(!to(n.value)||!Array.isArray(n.options)||n.options.length<1||n.options.length>16)return!1;let i=new Set;for(let a of n.options){if(!Zt(a)||!tt(a,["value","label"])||!to(a.value)||!eo(a.label)||i.has(a.value))return!1;i.add(a.value)}if(!i.has(n.value))return!1}return!0};var no=["{id}","{segment}","{segments+}"];var nn=new Set(no);var so=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var an=new Set(so);var ke=20000000,ye=256;var ot=(e)=>("bytes"in e)?e.bytes.byteLength:e.content.length,io=(e,o)=>{if(e.path!==o.path||e.readOnly!==o.readOnly)return!1;if(e.encoding==="text"||o.encoding==="text")return e.encoding==="text"&&o.encoding==="text"&&e.content===o.content;if(e.bytes.byteLength!==o.bytes.byteLength)return!1;for(let n=0;n<e.bytes.byteLength;n+=1)if(e.bytes[n]!==o.bytes[n])return!1;return!0};var ao=/^[A-Za-z0-9_-]{1,80}$/;var co=["left","right","top","bottom"];var lo=(e,o=0,n={remaining:16000})=>{if(--n.remaining<0||o>=32)return!1;if(e===null)return!0;let i=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let a of i)if(!lo(a,o+1,n))return!1;return!0},rt=(e)=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every((o)=>/^(0|[1-9]\d*)$/.test(o)&&Number(o)<e.length)&&e.every(rt);if(Object(e)===e){let o=Object.getPrototypeOf(e);return(o===null||o===Object.prototype)&&Object.values(e).every(rt)}return String(e)===e||Number.isFinite(e)},nt=(e)=>{try{if(String(e.id)!==e.id||!ao.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!co.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!lo(e.data)||!rt(e.data))return!1;return JSON.stringify(e.data).length<=16000}catch{return!1}};var fe=2000;var uo=["file","directory","other","missing"],it=(e)=>Boolean(e&&"sessionId"in e),at=(e)=>Boolean(e&&"sent"in e&&!("sessionId"in e));var _o=/^[0-9a-f]{7,64}$/i,ct=(e)=>_o.test(e),Ue=500,Me=32000,Eo=16000,To=128,So=200,fo=2000,Ao=16000,Oo=80,Ro=200,ho=16000;var mo=2000;var lt=20000,Ne=1024,ve=2000000;var Le=64000,we=8000,dt=4000;var pt=960000;var go=999,Pe=1e4,Ae=500,xo=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],bo=["stopped","starting","ready","failed"],ar=new Set(xo),Io=(e)=>ar.has(e),Co=(e)=>e&&Io(e)?e:"HOST_REJECTED",ae=(e)=>{if(e===void 0)return!1;if(e===null||e===!0||e===!1)return!0;if(String(e)===e)return!0;if(Number(e)===e)return Number.isFinite(e);if(Array.isArray(e))return e.every(ae);if(Object(e)===e)return Object.values(e).every(ae);return!1},ko=(e)=>ae(e)&&JSON.stringify(e).length<=ho,po=(e)=>e?.trim().slice(0,Ro)??"",ce=(e)=>{let o=e.id.trim().slice(0,To),n=e.title.trim().slice(0,So),i=e.url.trim().slice(0,fo),a=e.text?.trim().slice(0,Ao),c=e.author?.trim().slice(0,Oo),S=e.kind==="pull"?"pull":"issue",T={providerId:e.providerId.trim(),id:o,title:n||o,url:i,kind:S};if(a)T.text=a;if(c)T.author=c;if(S==="pull"){let R=po(e.branches?.head),f=po(e.branches?.base);if(R&&f)T.branches={head:R,base:f}}if(ko(e.data))T.data=e.data;return T},ut=(e)=>{let o=ce(e);if(e.projectId)o.projectId=e.projectId;if(e.navigation)o.navigation=e.navigation;if(e.worktree)o.worktree=e.worktree;return o},_t=(e)=>{let o={text:e.text.trim().slice(0,Eo)};if(e.send)o.send=!0;return o},Et=(e)=>{if(e===null||!Number.isFinite(e))return null;return Math.min(go,Math.max(0,Math.round(e)))},Tt=(e)=>{if(!Number.isFinite(e))return 0;return Math.min(Pe,Math.max(0,Math.ceil(e)))};var le=(e)=>e.length>0&&e.length<=Ne&&!e.includes("\x00")&&!e.includes("\\");var De=(e)=>{if(!e.startsWith("/")||e.includes("\x00")||e.includes("\\")||e.includes("://"))return!1;if(e.length>mo)return!1;return!e.split("/").some((n)=>n==="."||n==="..")},cr=new Set(bo),St=(e)=>Boolean(e&&"status"in e&&cr.has(String(e.status))&&!("body"in e)),Ge=(e)=>Boolean(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),ft=(e)=>Boolean(e&&"content"in e&&String(e.content)===e.content),At=(e)=>Boolean(e&&"written"in e&&e.written===!0),Ot=(e)=>Boolean(e&&"entries"in e&&Array.isArray(e.entries)),lr=new Set(uo),Rt=(e)=>Boolean(e&&"kind"in e&&"size"in e&&lr.has(String(e.kind))&&Number.isFinite(e.size)),ht=(e)=>Boolean(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),dr=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late"]),pr=(e)=>Object(e)===e?e:null,st=(e)=>String(e)===e&&e.length>0,ur=(e)=>{if(!st(e.id))return null;if(e.ok===!0){let o={channel:A,v:O,type:"result",id:e.id,ok:!0};if(Object(e.payload)===e.payload)o.payload=e.payload;return o}if(e.ok===!1&&st(e.error))return{channel:A,v:O,type:"result",id:e.id,ok:!1,error:e.error,code:Co(st(e.code)?e.code:void 0)};return null},mt=(e)=>{let o=pr(e);if(!o||o.channel!==A||o.v!==O)return null;if(o.type==="result")return ur(o);if(!dr.has(String(o.type))||Object(o.payload)!==o.payload)return null;return o};var yo=(e)=>("key"in e)&&("metaKey"in e)&&("ctrlKey"in e),_r=(e)=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s";class u extends Error{code;constructor(e,o){super(o);this.name="HostRequestError",this.code=e}}var Uo=()=>Promise.reject(new u("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),$e=()=>Promise.reject(new u("BAD_PATH",`File path must be 1 to ${Ne} characters without NUL or backslash.`)),Xe=(e)=>{if(e===void 0)return;if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new u("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0},E=(e)=>(e.value+=1,`oc-${e.value}`),gt=(e={})=>{let o=e.target??("window"in globalThis?window:null);if(!o)throw new u("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let n=e.acceptSource??((t)=>t===o.parent),i=e.requestTimeoutMs??lt,a=new Set,c=new Set,S=new Set,T=new Set,R=new Set,f=new Set,y=new Set,L=new Set,v=new Set,x=new Set,K=new Set,W=new Set,j=[],ee=null,z=null,te=new Set,w=new Set,_e=null,Ee=null,ze=!1,ne=new Map,se=new Map,ie=new Map,J=!1,_={value:0},p=null,Y=null,Te=!1,Se=!1,Xt=null,Ht=(t)=>{if(!t)return null;return{sessionId:t.id,phase:t.busy?"started":"completed"}},V=(t)=>{o.parent.postMessage(t,"*")},Vt=()=>{if(J||o.parent===o||W.size===0||p?.features?.lateGenerateResults!==!0)return;V({channel:A,v:O,type:"generate-late-listen"})},b=(t,r)=>{for(let l of t)try{l(r)}catch(d){console.error(d)}},Ft=(t)=>{if(!(t instanceof MessageEvent))return;if(!n(t.source))return;let r=mt(t.data);if(!r)return;if(r.type==="workspace"){let d=se.get(r.payload.subscriptionId);if(d)b([d],r.payload.snapshot);return}if(r.type==="shells"){let d=ie.get(r.payload.subscriptionId);if(d)b([d],r.payload.snapshot);return}if(r.type==="ready"){if(p=r.payload,Y=Ht(r.payload.session),b(a,r.payload),b(c,r.payload.directory),b(S,r.payload.session),Y)b(T,Y);if(b(R,r.payload.connection),b(f,r.payload.settings),b(y,r.payload.item),r.payload.block)b(L,r.payload.block);Vt();return}if(r.type==="service-event"){b(v,r.payload);return}if(r.type==="generate-late"){if(W.size===0)j.push(r.payload);else b(W,r.payload);return}if(r.type==="directory"){if(p)p={...p,directory:r.payload.directory};b(c,r.payload.directory);return}if(r.type==="session"){if(p)p={...p,session:r.payload.session};if(!r.payload.session)Y=null;else if(Y?.sessionId!==r.payload.session.id)Y=Ht(r.payload.session);b(S,r.payload.session);return}if(r.type==="session-lifecycle"){Y=r.payload,b(T,r.payload);return}if(r.type==="connection"){if(p)p={...p,connection:r.payload.connection};b(R,r.payload.connection);return}if(r.type==="settings"){if(p)p={...p,settings:r.payload.settings};b(f,r.payload.settings);return}if(r.type==="item"){if(p)p={...p,item:r.payload.item};b(y,r.payload.item);return}if(r.type==="status-control-event"){b(x,r.payload);return}if(r.type==="popover-closed"){b(K,r.payload);return}if(r.type==="action"){let d=(h)=>{if(!J)V({channel:A,v:O,type:"action-result",id:r.id,payload:h})},m=z;if(!m){d({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>m(r.payload)).then(()=>d({ok:!0}),(h)=>{let M=(h instanceof Error?h.message:String(h)).trim();d({ok:!1,error:(M||"Action failed.").slice(0,Ae)})});return}if(r.type==="file-open"){let d=r.payload;if(Ee&&io(Ee,d))return;Ee=d,b(te,r.payload);return}if(r.type==="file-saved"){b(w,r.payload.version);return}if(r.type==="file-snapshot"){let d=(M)=>{if(!J)V({channel:A,v:O,type:"file-snapshot-result",id:r.id,payload:M})},m=(M)=>d({error:(M.trim()||"Could not read the edited file.").slice(0,Ae)}),h=_e;if(!h){m("This extension does not edit files.");return}Promise.resolve().then(()=>h(r.payload.purpose)).then((M)=>{if(ot(M)>ke){m(`The file is over ${ke} ${"bytes"in M?"bytes":"characters"}.`);return}if(M.version.length>ye){m(`The snapshot version is over ${ye} characters.`);return}d({snapshot:"bytes"in M?{bytes:M.bytes,version:M.version}:{content:M.content,version:M.version}})},(M)=>m(M instanceof Error?M.message:String(M)));return}if(r.type==="resolve"){let d=(h)=>{V({channel:A,v:O,type:"resolve-result",id:r.id,payload:h})},m=ee;if(!m){d({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>m(r.payload)).then((h)=>d({item:h?ce(h):null}),(h)=>{let M=(h instanceof Error?h.message:String(h)).trim();d({error:(M||"Command failed.").slice(0,Ae)})});return}let l=ne.get(r.id);if(!l)return;if(clearTimeout(l.timer),ne.delete(r.id),r.ok){l.resolve(r.payload);return}l.reject(new u(r.code,r.error))};o.addEventListener("message",Ft),V({channel:A,v:O,type:"hello"});let P=(t,r=i)=>{if(J||o.parent===o)return Promise.reject(new u("HOST_UNAVAILABLE","No host frame. This page is not in an iframe."));return new Promise((l,d)=>{let m=setTimeout(()=>{ne.delete(t.id),d(new u("HOST_TIMEOUT","Host did not answer in time."))},r);ne.set(t.id,{resolve:l,reject:d,timer:m}),V(t)})},k=(t)=>P(t).then(()=>{return}),U={channel:A,v:O},Je=(t)=>{if(!J&&o.parent!==o)V(t)},Bt=()=>Je({...U,type:"file-save"}),Kt=(t)=>{if(!yo(t)||!_r(t))return;t.preventDefault(),Bt()},Wt=(t)=>{if(!yo(t)||t.key!=="Escape"||p?.surface!=="popover"||!p.popover)return;t.preventDefault(),Yt(p.popover.id,"escape").catch(()=>{return})},ge=()=>{let t=p?.surface==="popover"?p.popover:void 0;if(!t)return;let r=Te||Se;if(Xt===r)return;Xt=r,Qt(t.id,r).catch(()=>{return})},xe=()=>{if(p?.surface!=="popover"||Te)return;Te=!0,ge()},jt=(t)=>{if(p?.surface!=="popover"||t.relatedTarget!==null||!Te)return;Te=!1,ge()},zt=()=>{if(p?.surface!=="popover"||Se)return;Se=!0,ge()},Jt=()=>{if(p?.surface!=="popover"||!Se)return;Se=!1,ge()},B=(t,r=1024)=>{if(!t.trim()||t.length>r)throw new u("HOST_REJECTED",`Identity must contain 1 to ${r} characters.`)},Ye=async(t)=>{if(t.kind!=="projects")B(t.projectId);let r=await P({...U,type:"workspace-read",id:E(_),payload:t});if(!r||!("kind"in r)||!("state"in r)||r.kind!==t.kind)throw new u("HOST_REJECTED","Host did not return workspace data.");return r},Qe=async(t,r)=>{if(t.kind!=="projects")B(t.projectId);let l=E(_);se.set(l,r);try{await k({...U,type:"workspace-subscribe",id:E(_),payload:{subscriptionId:l,query:t}})}catch(d){if(se.delete(l),!J)V({...U,type:"workspace-unsubscribe",id:E(_),payload:{subscriptionId:l}});throw d}return()=>{if(!se.delete(l)||J)return;V({...U,type:"workspace-unsubscribe",id:E(_),payload:{subscriptionId:l}})}},nr=async(t,r)=>{if(t.kind==="session")B(t.sessionId);if(t.kind==="project")B(t.projectId);let l=E(_);ie.set(l,r);try{await k({...U,type:"shells-subscribe",id:E(_),payload:{subscriptionId:l,scope:t}})}catch(d){if(ie.delete(l),!J)V({...U,type:"shells-unsubscribe",id:E(_),payload:{subscriptionId:l}});throw d}return()=>{if(!ie.delete(l)||J)return;V({...U,type:"shells-unsubscribe",id:E(_),payload:{subscriptionId:l}})}},be=async(t)=>{if("key"in t&&(t.key.length===0||t.key.length>Ze))throw new u("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!ae(t.value))throw new u("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>et)throw new u("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&p?.features?.deviceStorage!==!0)throw new u("UNSUPPORTED","This host does not support device storage.");let r=await P({...U,type:"storage",id:E(_),payload:t});if(!r||!("storage"in r)||r.op!==t.op)throw new u("HOST_REJECTED","Host did not return storage data.");return r},Yt=(t,r)=>p?.features?.popovers!==!0&&!(p?.surface==="popover"&&p.popover?.id===t)?Promise.reject(new u("UNSUPPORTED","This host does not support popovers.")):k({...U,type:"popover-close",id:E(_),payload:r?{id:t,reason:r}:{id:t}}),Qt=(t,r)=>p?.features?.popovers!==!0&&!(p?.surface==="popover"&&p.popover?.id===t)?Promise.reject(new u("UNSUPPORTED","This host does not support popovers.")):k({...U,type:"popover-anchor",id:E(_),payload:{id:t,active:r}});return o.addEventListener("keydown",Wt,!0),o.addEventListener("pointerover",xe),o.addEventListener("pointermove",xe),o.addEventListener("pointerout",jt),o.addEventListener("focus",zt),o.addEventListener("blur",Jt),{onAction:(t)=>(z=t,()=>{if(z===t)z=null}),listProjects:async()=>{let t=await Ye({kind:"projects"});if(t.kind!=="projects")throw new u("HOST_REJECTED","Expected projects.");return t},listWorktrees:async(t)=>{let r=await Ye({kind:"worktrees",projectId:t});if(r.kind!=="worktrees")throw new u("HOST_REJECTED","Expected worktrees.");return r},listSessions:async(t)=>{let r=await Ye({kind:"sessions",projectId:t});if(r.kind!=="sessions")throw new u("HOST_REJECTED","Expected sessions.");return r},onProjects:(t)=>Qe({kind:"projects"},(r)=>{if(r.kind==="projects")t(r)}),onWorktrees:(t,r)=>Qe({kind:"worktrees",projectId:t},(l)=>{if(l.kind==="worktrees")r(l)}),onSessions:(t,r)=>Qe({kind:"sessions",projectId:t},(l)=>{if(l.kind==="sessions")r(l)}),onRunningShells:(t,r)=>nr(t,r),readShellOutput:async(t,r)=>{B(t,Ie);let l=r?.cursor;if(l!==void 0&&(!Number.isInteger(l)||l<0))throw new u("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let d=r?.tailBytes;if(d!==void 0&&(!Number.isInteger(d)||d<1||d>Ce))throw new u("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${Ce}.`);let h=await P({...U,type:"shell-output",id:E(_),payload:{shellId:t,cursor:l,tailBytes:d}});if(!h||typeof h.output!=="string"||!Number.isFinite(h.cursor))throw new u("HOST_REJECTED","Host did not return shell output.");return h},stopShell:async(t)=>{if(B(t,Ie),(await P({...U,type:"shell-stop",id:E(_),payload:{shellId:t}}))?.stopped!==!0)throw new u("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async(t)=>{B(t),await k({...U,type:"open-session",id:E(_),payload:{sessionId:t}})},storage:{get:async(t,r)=>{let l=Xe(r),d={op:"get",key:t};if(l)d.scope=l;let m=await be(d);return m.op==="get"&&m.found?m.value:void 0},set:async(t,r,l)=>{let d=Xe(l),m={op:"set",key:t,value:r};if(d)m.scope=d;await be(m)},delete:async(t,r)=>{let l=Xe(r),d={op:"delete",key:t};if(l)d.scope=l;await be(d)},keys:async(t)=>{let r=Xe(t),l={op:"keys"};if(r)l.scope=r;let d=await be(l);if(d.op!=="keys")throw new u("HOST_REJECTED","Expected storage keys.");return d.keys}},onReady:(t)=>{if(a.add(t),p)t(p);return()=>{a.delete(t)}},onDirectory:(t)=>{if(c.add(t),p)t(p.directory);return()=>{c.delete(t)}},onSession:(t)=>{if(S.add(t),p)t(p.session);return()=>{S.delete(t)}},onSessionLifecycle:(t)=>{if(T.add(t),Y)t(Y);return()=>{T.delete(t)}},onConnection:(t)=>{if(R.add(t),p)t(p.connection);return()=>{R.delete(t)}},onSettings:(t)=>{if(f.add(t),p)t(p.settings);return()=>{f.delete(t)}},onItem:(t)=>{if(y.add(t),p)t(p.item);return()=>{y.delete(t)}},onBlock:(t)=>{if(L.add(t),p?.block)t(p.block);return()=>{L.delete(t)}},onServiceEvent:(t)=>(v.add(t),()=>{v.delete(t)}),onStatusControl:(t)=>(x.add(t),()=>{x.delete(t)}),onPopoverClosed:(t)=>(K.add(t),()=>{K.delete(t)}),setStatusControls:(t)=>{if(p?.features?.statusControls!==!0)return Promise.reject(new u("UNSUPPORTED","This host does not support status controls."));if(!ro(t))return Promise.reject(new u("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options."));return k({...U,type:"status-controls",id:E(_),payload:{controls:t}})},openPopover:(t)=>{if(p?.features?.popovers!==!0)return Promise.reject(new u("UNSUPPORTED","This host does not support popovers."));if(!nt(t))return Promise.reject(new u("HOST_REJECTED","Popover requests need bounded geometry and JSON data."));return k({...U,type:"popover-open",id:E(_),payload:t})},closePopover:Yt,setPopoverAnchorActive:Qt,onResolve:(t)=>(ee=t,()=>{if(ee===t)ee=null}),toast:(t)=>{let r=t.message.trim();if(!r||r.length>Ue)return Promise.reject(new u("HOST_REJECTED",`Toast message must contain 1 to ${Ue} characters.`));if(t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>Me))return Promise.reject(new u("HOST_REJECTED",`Toast copy text must contain 1 to ${Me} characters.`));return k({channel:A,v:O,type:"toast",id:E(_),payload:{...t,message:r}})},openUrl:(t)=>k({channel:A,v:O,type:"open-url",id:E(_),payload:{url:t}}),openCommit:(t)=>ct(t)?k({channel:A,v:O,type:"open-commit",id:E(_),payload:{sha:t}}):Promise.reject(new u("HOST_REJECTED","Commit id must be 7 to 64 hex characters.")),answerBlock:(t)=>k({channel:A,v:O,type:"block-answer",id:E(_),payload:{text:t.trim().slice(0,fe)}}),openSurface:(t)=>k({channel:A,v:O,type:"open-surface",id:E(_),payload:{surfaceId:t}}),writeClipboard:(t)=>k({channel:A,v:O,type:"clipboard-write",id:E(_),payload:{text:t}}),compose:(t)=>k({channel:A,v:O,type:"compose",id:E(_),payload:t}),attach:(t)=>k({channel:A,v:O,type:"attach",id:E(_),payload:ce(t)}),startSession:async(t)=>{if(t.projectId!==void 0)B(t.projectId);let r=t.worktree;if(r&&r!==!0)if(r.kind==="existing")B(r.directory);else{if(r.name!==void 0)B(r.name,200);if(r.baseBranch!==void 0)B(r.baseBranch,200)}let l=await P({channel:A,v:O,type:"start-session",id:E(_),payload:ut(t)},e.requestTimeoutMs??180000);if(!it(l))throw new u("HOST_REJECTED","Host did not return a session.");return l},prompt:(t)=>P({channel:A,v:O,type:"prompt",id:E(_),payload:_t(t)}).then((r)=>{if(!at(r))throw new u("HOST_REJECTED","Host did not return a prompt result.");return r}),sessionLink:(t)=>k({channel:A,v:O,type:"session-link",id:E(_),payload:ce(t)}),close:()=>k({channel:A,v:O,type:"close",id:E(_)}),oauthStart:()=>k({channel:A,v:O,type:"oauth-start",id:E(_)}),oauthDisconnect:()=>k({channel:A,v:O,type:"oauth-disconnect",id:E(_)}),request:(t)=>(De(t.path)?P({channel:A,v:O,type:"request",id:E(_),payload:t}):Uo()).then((r)=>{if(!Ge(r))throw new u("HOST_REJECTED","Host request result was empty.");return r}),serviceRequest:(t)=>(De(t.path)?P({channel:A,v:O,type:"service-request",id:E(_),payload:t}):Uo()).then((r)=>{if(!Ge(r))throw new u("HOST_REJECTED","Host service request result was empty.");return r}),serviceStatus:()=>P({channel:A,v:O,type:"service-status",id:E(_)}).then((t)=>{if(!St(t))throw new u("HOST_REJECTED","Host did not return service status.");return t}),readFile:(t)=>(le(t)?P({channel:A,v:O,type:"file-read",id:E(_),payload:{path:t}}):$e()).then((r)=>{if(!ft(r))throw new u("HOST_REJECTED","Host did not return file content.");return r}),writeFile:(t,r)=>{if(!le(t))return $e();if(r.length>ve)return Promise.reject(new u("FILE_TOO_LARGE",`Content is over ${ve} characters.`));return P({channel:A,v:O,type:"file-write",id:E(_),payload:{path:t,content:r}}).then((l)=>{if(!At(l))throw new u("HOST_REJECTED","Host did not confirm the write.");return l})},listDir:(t)=>(le(t)?P({channel:A,v:O,type:"file-list",id:E(_),payload:{path:t}}):$e()).then((r)=>{if(!Ot(r))throw new u("HOST_REJECTED","Host did not return directory entries.");return r}),stat:(t)=>(le(t)?P({channel:A,v:O,type:"file-stat",id:E(_),payload:{path:t}}):$e()).then((r)=>{if(!Rt(r))throw new u("HOST_REJECTED","Host did not return file status.");return r}),generate:(t)=>{let r=t.prompt.trim(),l=t.system?.trim();if(r.length===0||r.length>Le)return Promise.reject(new u("HOST_REJECTED",`Prompt must be 1 to ${Le} characters.`));if(l!==void 0&&(l.length===0||l.length>we))return Promise.reject(new u("HOST_REJECTED",`System prompt must be 1 to ${we} characters.`));let d=t.maxOutputTokens===void 0?void 0:Math.min(dt,Math.max(1,Math.floor(t.maxOutputTokens)));if(d!==void 0&&!Number.isFinite(d))return Promise.reject(new u("HOST_REJECTED","maxOutputTokens must be a number."));let m={prompt:r};if(l!==void 0)m.system=l;if(d!==void 0)m.maxOutputTokens=d;return P({channel:A,v:O,type:"generate",id:E(_),payload:m},e.requestTimeoutMs??pt).then((h)=>{if(!ht(h))throw new u("HOST_REJECTED","Host did not return generated text.");return h})},onLateGenerateResult:(t)=>{W.add(t);for(let r of j.splice(0))b([t],r);return Vt(),()=>{W.delete(t)}},setBadge:(t)=>k({channel:A,v:O,type:"badge",id:E(_),payload:{count:Et(t)}}),setHeight:(t)=>k({channel:A,v:O,type:"resize",id:E(_),payload:{height:Tt(t)}}),onFileOpen:(t)=>{if(te.add(t),!ze)ze=!0,o.addEventListener("keydown",Kt,!0);if(Ee)t(Ee);return()=>{te.delete(t)}},onFileSnapshot:(t)=>(_e=t,()=>{if(_e===t)_e=null}),onFileSaved:(t)=>(w.add(t),()=>{w.delete(t)}),reportFileChange:(t)=>Je({...U,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:Bt,reportFileUnsupported:()=>Je({...U,type:"file-unsupported"}),dispose:()=>{for(let t of se.keys())V({...U,type:"workspace-unsubscribe",id:E(_),payload:{subscriptionId:t}});se.clear();for(let t of ie.keys())V({...U,type:"shells-unsubscribe",id:E(_),payload:{subscriptionId:t}});if(ie.clear(),J=!0,ee=null,z=null,_e=null,te.clear(),w.clear(),ze)o.removeEventListener("keydown",Kt,!0);o.removeEventListener("message",Ft),o.removeEventListener("keydown",Wt,!0),o.removeEventListener("pointerover",xe),o.removeEventListener("pointermove",xe),o.removeEventListener("pointerout",jt),o.removeEventListener("focus",zt),o.removeEventListener("blur",Jt);for(let t of ne.values())clearTimeout(t.timer),t.reject(new u("HOST_UNAVAILABLE","Host client was disposed."));ne.clear(),a.clear(),c.clear(),S.clear(),T.clear(),R.clear(),f.clear(),y.clear(),L.clear(),v.clear(),x.clear(),K.clear(),W.clear(),j.length=0}}};var Mo=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var gn=new Set(Mo);var No=["none","agent","user"];var bn=new Set(No);var Er=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],Tr=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],vo=(e,o)=>{o.style.colorScheme=e.mode;for(let[n,i]of Er)o.style.setProperty(n,e.tokens[i]);for(let[n,i,a]of Tr){let c=e.tokens[a]??"";o.style.setProperty(n,c),o.style.setProperty(i,c)}o.style.setProperty("font-family",e.tokens.font),o.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),o.style.setProperty("line-height","1.45"),o.style.setProperty("color",e.tokens.foreground)},xt=(e,o)=>{if(vo(e.theme,o),o.dataset)o.dataset.ocSurface=e.surface,o.dataset.ocTheme=e.theme.mode};var Sr={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},g=(e,o)=>`var(--${e}, var(--oc-${Sr[e]}, ${o}))`,q=g("surface-background","transparent"),Ve=g("surface-elevated","transparent"),de=g("surface-elevated-foreground","inherit"),F=g("surface-foreground","inherit"),I=g("surface-muted-foreground","gray"),fr=g("surface-muted","transparent"),oe=g("interactive-border","currentColor"),G=g("interactive-hover","transparent"),re=g("interactive-active","transparent"),bt=g("interactive-selection","transparent"),It=g("interactive-selection-foreground","inherit"),Q=g("primary","currentColor"),Ct=g("primary-text","inherit"),kt=g("error-text","inherit"),Ar=g("font-sans","inherit"),yt=g("font-mono","monospace"),Do=g("radius","9px"),Ut=`calc(${Do} - 2px)`,Lo=`calc(${Do} - 4px)`,C=(e,o,n="transparent")=>`color-mix(in srgb, ${e} ${o}%, ${n})`,wo=`background-image: linear-gradient(${G}, ${G});`,Mt=(e,o="0.5px")=>`box-shadow: inset 0 0 0 ${o} ${e}, var(--oc-sdk-field-lift);`,Nt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Po="box-shadow: var(--oc-sdk-lit);",vt=`inset 0 0.5px 0 0 ${C(F,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,Or=`
:root {
  --oc-sdk-edge: ${C(F,16)};
  --oc-sdk-field-bg: ${Ve};
  --oc-sdk-raised-bg: ${q};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${C(F,14)};
  --oc-sdk-field-bg: ${C(q,50,Ve)};
  --oc-sdk-raised-bg: ${Ve};
  --oc-sdk-field-lift: ${vt};
  --oc-sdk-raised-lift: ${vt};
  --oc-sdk-lit: ${vt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,He=(e)=>{let o=g(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${o}; --oc-sdk-tone-text: ${g(`${e}-text`,"inherit")}; }`},s=(e)=>`calc(${e}rem / 14)`,Rr=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${s(8)}; height: ${s(32)}; padding: 0 ${s(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${s(6)}; height: ${s(28)}; padding: 0 ${s(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${s(4)}; height: ${s(24)}; padding: 0 ${s(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${s(14)}; height: ${s(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${s(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${s(32)}; padding: 0 ${s(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${s(8)} ${s(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${s(34)}; padding-right: ${s(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${s(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${s(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${s(24)}; height: ${s(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${s(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${s(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${s(28)}; padding: 0 ${s(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${s(2)}; min-width: ${s(160)}; max-width: calc(100vw - ${s(16)}); max-height: min(${s(320)}, calc(100vh - ${s(16)})); overflow: auto; padding: ${s(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${s(2)} ${s(2)} ${s(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${s(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${s(8)}; width: 100%; padding: ${s(6)} ${s(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${s(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${s(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${s(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${s(14)}; height: ${s(14)}; margin-top: ${s(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${s(36)}; height: ${s(20)}; --oc-sdk-thumb-travel: ${s(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${s(2)}; left: ${s(2)}; width: ${s(16)}; height: ${s(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${s(2)}; padding: ${s(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${s(6)}; height: ${s(28)}; padding: 0 ${s(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${s(1)} ${s(6)}; font-size: ${s(11)}; font-weight: 500; line-height: ${s(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${s(8)}; width: 100%; padding: ${s(6)} ${s(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${s(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${s(16)} ${s(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${s(4)}; padding: ${s(40)} ${s(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${s(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${s(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${s(16)}; height: ${s(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${s(12)}; height: ${s(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${s(12)}; padding: ${s(8)} ${s(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${s(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${s(8)}; width: 100%; margin: ${s(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${s(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${s(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${s(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${s(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${s(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${s(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${s(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${s(36)}; height: ${s(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${s(44)}; }
  .oc-sdk-check { min-height: ${s(36)}; padding: ${s(8)} 0; }
}
`,Go=`${Or}
.oc-sdk { color: ${F}; font-family: ${Ar}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${wo} }
.oc-sdk-mono { font-family: ${yt}; }
.oc-sdk-muted { color: ${I}; }
${He("success")}${He("warning")}${He("error")}${He("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${Q}; --oc-sdk-tone-text: ${Ct}; }

.oc-sdk-btn { border-radius: ${Ut}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Lo}; }
.oc-sdk-btn[data-variant="default"] { color: ${Ct}; background: ${C(Q,10,q)}; border-color: ${C(Q,12)}; ${Po} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${C(Q,16,q)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${C(Q,22,q)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${fr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${G}, ${G}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${re}, ${re}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${de}; ${Nt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${G}, ${G}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${re}, ${re}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${G}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${re}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${g("status-error","red")}; color: ${kt}; background: ${C("var(--oc-sdk-tone)",7,q)}; border-color: ${C("var(--oc-sdk-tone)",12)}; ${Po} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${C("var(--oc-sdk-tone)",9,q)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${C("var(--oc-sdk-tone)",11,q)}; box-shadow: none; }

.oc-sdk-field-note { color: ${I}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${kt}; }
.oc-sdk-input { border-radius: ${Ut}; background: var(--oc-sdk-field-bg); color: ${de}; ${Mt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${I}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${G}, ${G}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${Mt(C(F,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${Mt(g("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${yt}; }

.oc-sdk-search-icon { color: ${I}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${Q}; }
.oc-sdk-search-clear { border-radius: ${Lo}; color: ${I}; }
.oc-sdk-search-clear:hover { background: ${G}; color: ${F}; }

.oc-sdk-trigger { border-radius: ${Ut}; background: var(--oc-sdk-raised-bg); color: ${de}; ${Nt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${G}, ${G}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${re}, ${re}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${I}; }
.oc-sdk-trigger-chevron { color: ${I}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${de}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${Ve}; background-clip: padding-box; color: ${de}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${G}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${bt}; color: ${It}; }
.oc-sdk-option-check { color: ${F}; }
.oc-sdk-option[data-destructive="true"] { color: ${kt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${C(g("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${I}; }
.oc-sdk-popup-empty { color: ${I}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${oe}; border-radius: 4px; color: ${F}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${C(F,60,oe)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${oe}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${q}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${Q}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${wo} }
.oc-sdk-check-desc { color: ${I}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${C(F,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${I}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${F}; }
.oc-sdk-tab[aria-selected="true"] { color: ${It}; background: ${bt}; border-color: ${oe}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${de}; background: var(--oc-sdk-raised-bg); ${Nt} }
.oc-sdk-tab-count { color: ${I}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${C(F,6)}; color: ${I}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${C("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${G}; }
.oc-sdk-row[aria-selected="true"] { background: ${bt}; color: ${It}; }
.oc-sdk-row-lead { font-family: ${yt}; color: ${I}; }
.oc-sdk-row-sub { color: ${I}; }
.oc-sdk-row-meta { color: ${I}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${I}; }

.oc-sdk-empty-body { color: ${I}; }

.oc-sdk-spinner { color: ${I}; }
.oc-sdk-spinner-ring { border-color: ${oe}; border-top-color: ${Q}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${C("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${I}; }

.oc-sdk-separator { color: ${I}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${C(oe,40)}; }

.oc-sdk-progress-label { color: ${I}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${C(F,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${Q}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${g("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${g("success-text","inherit")}; }

.oc-sdk-text a { color: ${Ct}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${C(oe,60)}; }
`,D=`
${qe}
${Rr}
${Go}`;var Re=(e)=>{if(!Number.isFinite(e)||e<0)return"—";let o=Math.round(e/1000),n=Math.floor(o/3600),i=Math.floor(o%3600/60),a=o%60;if(n>0)return`${n}h ${i}m`;if(i>0)return`${i}m ${String(a).padStart(2,"0")}s`;return`${a}s`};var wt=(e,o=Date.now())=>{let n=e.startedAt??e.createdAt,i=e.finishedAt??(e.status==="completed"?null:o);if(n===null||i===null)return null;return Math.max(0,i-n)},br=(e)=>{if(e.startedAt===null)return null;return Math.max(0,e.startedAt-e.createdAt)},$o=(e,o=Date.now())=>{let n=wt(e,o);if(n===null)return null;let i=br(e);return i!==null&&i>=5000?`${Re(i)} + ${Re(n)}`:Re(n)};var Pt=(e)=>e==="failure"||e==="timed_out"||e==="startup_failure",je=(e)=>Pt(e.conclusion);var Ir=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/,Cr=/\u001b\[[0-?]*[ -/]*[@-~]/g,kr=/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g,Dt=/\r?\n/,yr=(e)=>e.replace(Ir,""),Ur=(e)=>e.replace(kr,"").replace(Cr,"");var Mr=(e)=>{let o=e.split(Dt);if(o.length>1&&o.at(-1)==="")o.pop();return o};var Nr=/^section_start:\d+:([^[\r\s]+)(?:\[[^\]]*\])?\r?(.*)$/,vr=/^section_end:\d+:[^\r]*\r?(.*)$/,Xo=(e)=>{let o=e.split("\r");for(let n=o.length-1;n>=0;n-=1)if(o[n].trim()!=="")return o[n];return""},Lr=(e)=>{if(/^(?:ERROR|error):/.test(e))return"error";if(/^WARNING:/.test(e))return"warning";if(/^\$ /.test(e))return"command";return"normal"},wr=(e)=>{let o=[],n=[],i=(a)=>{let c=Nr.exec(a);if(c){let R=Xo(c[2]).trim()||c[1];o.push({text:R,depth:Math.min(1,n.length),group:n.at(-1)??null,tone:"group"}),n.push(R);return}let S=vr.exec(a);if(S){if(n.pop(),S[1].trim()!=="")i(S[1]);return}let T=Xo(a);o.push({text:T,depth:Math.min(1,n.length),group:n.at(-1)??null,tone:Lr(T)})};for(let a of Mr(e))i(Ur(a));return o};var Pr=[/##\[error\]/,/::error/,/\berror\b/i,/\bfailed\b/i,/\bfailure\b/i,/\bexception\b/i,/\btraceback\b/i,/\bexit code\b/i,/\bnpm ERR!/,/\bELIFECYCLE\b/,/\bcannot find\b/i,/\bnot found\b/i,/\bpanic:/,/\bsegmentation fault\b/i],Ho=(e)=>Pr.some((o)=>o.test(e)),Dr={github:/Process completed with exit code/,gitlab:/^ERROR: Job failed: exit code/,plain:/Process completed with exit code|^ERROR: Job failed: exit code/},Gr=(e,o)=>{if(o==="gitlab")return wr(e).map((n)=>n.text);if(o==="plain")return e.split(Dt);return e.split(Dt).map(yr)},Fo=(e,o,n="github")=>{let i=o?.maxLines??120,a=o?.context??12,c=Gr(e,n),S=(x)=>x.length>i?{lines:x.slice(0,i),truncated:!0}:{lines:x,truncated:!1},T=o?.maxBytes??8192,R=(x)=>Dr[n].test(x),f=c.findIndex((x)=>x.trim()!==""&&Ho(x)&&!R(x));if(f===-1)f=c.findIndex((x)=>Ho(x)&&x.trim()!=="");if(f===-1)return Vo(S(c.slice(-Math.min(i,c.length))),T);let y=Math.max(0,f-a),L=c.slice(y,Math.min(c.length,f+i-a)),v=y>0?[`… ${y} earlier lines omitted …`,...L]:L;return Vo({lines:v,truncated:y>0||L.length<c.length-y},T)},Vo=(e,o)=>{let n=0,i=[];for(let a of e.lines){if(n+=a.length+1,n>o)return{lines:i,truncated:!0};i.push(a)}return e};var Bo=["github","gitlab","gitea","forgejo","woodpecker","bitbucket"];var $r=/^[a-z0-9.-]+(:\d+)?$/,Xr=/^(?!\.\.?$)[\w.-]+$/,Hr=(e)=>Bo.includes(e);var he=(e)=>{let o=e.indexOf(":");if(o<=0)return null;let n=e.slice(0,o);if(!Hr(n))return null;let i=e.slice(o+1),a=i.indexOf("/");if(a<=0)return null;let c=i.slice(0,a).toLowerCase(),S=i.slice(a+1);if(!$r.test(c))return null;let T=S.split("/");if(T.length<2||!T.every((R)=>Xr.test(R)))return null;return{provider:n,host:c,path:S}};var Vr=(e)=>he(e)?.path??e,Ko=(e)=>Vr(e);var me=(e)=>e.filter((o)=>Pt(o.conclusion)),jo=(e)=>me(e)[0]??e.find((o)=>o.status!=="completed")??e[0]??null,Fr=(e)=>e.steps.find((o)=>o.conclusion==="failure"||o.conclusion==="timed_out")??null,Br=(e,o)=>{let n=o?.name??e.workflow,i=je(e)||o&&me([o]).length>0?"failed":e.conclusion??e.status;return`#${e.number} ${n} ${i}`.slice(0,200)},Wo=15000,zo=({run:e,jobs:o,job:n,log:i,logTruncated:a,mode:c="read"})=>{let S=n?Fr(n):null,T=wt(e),R=he(e.repo),f=[`CI run ${e.workflow} #${e.number} on ${Ko(e.repo)} ${e.conclusion??e.status}.`,"",`- Repository: ${R?`${R.host}/${R.path}`:e.repo}`,`- Run: ${e.url}`,`- Workflow: ${e.workflow}`,`- Branch: ${e.branch||"—"} @ ${e.sha.slice(0,12)}`,`- Commit: ${e.title||"—"}`,`- Event: ${e.event}, attempt ${e.attempt}${T!==null?`, ${Re(T)}`:""}`],y=me(o);if(y.length>0)f.push(`- Failed jobs: ${y.map((v)=>v.name).join(", ")}`);if(n){if(f.push(`- Job: ${n.name}${n.url?` (${n.url})`:""}`),S)f.push(`- Failing step: ${S.number}. ${S.name}`)}if(i!==null&&i.trim()!==""){let v=Fo(i,{maxLines:120,context:20,maxBytes:8192});f.push("",`Log excerpt${a||v.truncated?" (partial)":""}:`,"```",...v.lines.map((x)=>x.replace(/```/g,"'''")),"```")}else if(n)f.push("","The job log could not be read.");if(c==="fix"&&n)f.push("","Fix the failure in this job and commit the fix in the current branch. Do not push.");let L=f.join(`
`);if(L.length>Wo)L=`${L.slice(0,Wo-4)}
…`;return{title:Br(e,n),text:L,url:e.url}};var Jo=/^\d+$/,Yo=/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,Kr=String.raw`(\d+|\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?)`,Wr=new RegExp(String.raw`\/(?:actions\/runs|runs|pipelines|pipeline)\/${Kr}(?:[/?#]|$)`),Qo=(e)=>{let o=typeof e.repo==="string"?e.repo.trim():"";if(!o||!he(o))throw Error('CiRun needs a "repo" argument: the repository key, as provider:host/owner/name.');let n=typeof e.runId==="string"?e.runId.trim():"";if(!n)throw Error('CiRun needs a "runId" argument: the run id or its URL.');let i=n.replace(/^\{|\}$/g,""),c=Jo.test(i)||Yo.test(i)?i:Wr.exec(n)?.[1]?.replace(/^\{|\}$/g,"");if(!c||!(Jo.test(c)||Yo.test(c)))throw Error(`CiRun: runId "${n.slice(0,120)}" is not a run id or a run URL.`);return{repo:o,runId:c}},qo=(e)=>`${e.workflow} #${e.number} · ${e.conclusion??e.status}`,Zo=(e)=>e.slice(0,fe);var N=(e,o,...n)=>{let i=document.createElement(e);for(let[a,c]of Object.entries(o??{})){if(c===null||c===void 0||c===!1)continue;if(a==="class")i.className=String(c);else if(a==="text")i.textContent=String(c);else if(a.startsWith("on")&&typeof c==="function")i.addEventListener(a.slice(2),c);else if(c===!0)i.setAttribute(a,"");else i.setAttribute(a,String(c))}for(let a of n.flat()){if(a===null||a===void 0||a===!1)continue;i.append(typeof a==="number"?String(a):a)}return i};class Gt extends Error{status;kind;retryAt;constructor(e,o,n=null,i=null){super(o);this.status=e,this.kind=n,this.retryAt=i}}var jr=(e)=>{if(!e)return;try{return JSON.parse(e)}catch{return e}},er=(e)=>async(o)=>{let n={};for(let[S,T]of Object.entries(o.query??{}))if(T!==void 0&&T!==null&&T!=="")n[S]=T;let i={method:o.method??"GET",path:o.path,query:n,body:o.body===void 0?void 0:JSON.stringify(o.body)},a;try{a=await e.serviceRequest(i)}catch(S){let T=S instanceof Error?S.message:String(S);throw new Gt(0,`CI Hub's service did not answer (${T}).`,"service")}let c=jr(a.body);if(a.status>=400){let S=c&&typeof c==="object"?c:{},T=typeof S.message==="string"&&S.message?S.message:typeof c==="string"&&c?c.slice(0,300):`CI Hub's service answered ${a.status}.`;throw new Gt(a.status,T,typeof S.kind==="string"?S.kind:null,typeof S.retryAt==="number"?S.retryAt:null)}return c},ue=(e)=>e instanceof Error?e.message:typeof e==="string"?e:"Something went wrong.";var zr=`
html,body{margin:0}
body{font-family:var(--oc-font,system-ui,sans-serif);font-size:13px;color:var(--oc-fg,inherit);background:transparent}
*{box-sizing:border-box}
[hidden]{display:none!important}
.cihb{border:1px solid var(--oc-border,color-mix(in srgb,currentColor 18%,transparent));border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.cihb-title{font-weight:600;font-size:13px;overflow-wrap:anywhere}
.cihb-meta{font-size:12px;color:var(--oc-muted,color-mix(in srgb,currentColor 60%,transparent));display:flex;flex-wrap:wrap;gap:4px 10px}
.cihb-sha{background:none;border:0;padding:0;font:inherit;font-family:var(--oc-mono,ui-monospace,monospace);font-size:12px;color:var(--oc-primary-text,inherit);cursor:pointer;text-decoration:underline}
.cihb-jobs{display:flex;flex-direction:column;gap:3px;font-size:12px}
.cihb-job{display:flex;gap:6px;align-items:baseline}
.cihb-job[data-tone="error"]{color:var(--oc-error-text,var(--oc-error,inherit))}
.cihb-actions{display:flex;flex-wrap:wrap;gap:6px}
.cihb-btn{border:1px solid var(--oc-border,color-mix(in srgb,currentColor 18%,transparent));background:var(--oc-muted-surface,transparent);color:inherit;font:inherit;font-size:12px;border-radius:7px;padding:4px 10px;cursor:pointer}
.cihb-btn:hover{background:var(--oc-hover,color-mix(in srgb,currentColor 7%,transparent))}
.cihb-btn:disabled{opacity:.5;cursor:default}
.cihb-log{margin:0;max-height:260px;overflow:auto;font-family:var(--oc-mono,ui-monospace,monospace);font-size:11.5px;white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid var(--oc-border,transparent);padding-top:8px}
.cihb-error{color:var(--oc-error-text,var(--oc-error,inherit));font-size:12px;overflow-wrap:anywhere}
`,tr=(e,o)=>{document.head.append(N("style",null,zr));let n=er(e),i=N("div",{class:"cihb"});o.append(i);let a=()=>{let T=Math.ceil(i.getBoundingClientRect().height);e.setHeight(Math.min(Math.max(T,24),Pe)).catch(()=>{return})},c=(T)=>{i.textContent="",i.append(N("div",{class:"cihb-error",text:T})),a()},S=async(T)=>{let R;try{R=Qo(T.args)}catch(j){c(ue(j));return}let f,y;i.textContent="",i.append(N("div",{class:"cihb-meta",text:"Loading the run…"})),a();try{({run:f,jobs:y}=await n({path:"/run",query:R}))}catch(j){c(ue(j));return}let L=jo(y),v=null,x=!1,K=!1,W=()=>{i.textContent="";let j=$o(f);i.append(N("div",{class:"cihb-title",text:qo(f)})),i.append(N("div",{class:"cihb-meta"},N("span",{text:f.branch||"—"}),N("button",{class:"cihb-sha",type:"button",title:"Open the commit diff",text:f.sha.slice(0,7),onClick:()=>void e.openCommit(f.sha).catch(()=>{return})}),j?N("span",{text:j}):null,N("span",{text:`attempt ${f.attempt}`})));let ee=me(y);if(ee.length>0)i.append(N("div",{class:"cihb-jobs"},ee.slice(0,6).map((w)=>N("div",{class:"cihb-job","data-tone":"error"},N("span",{text:`✕ ${w.name}`})))));let z=N("div",{class:"cihb-actions"}),te=N("button",{class:"cihb-btn",type:"button",text:je(f)?"Re-run failed jobs":"Re-run",onClick:async()=>{te.disabled=!0;try{await n({method:"POST",path:"/action",body:{kind:"rerun-failed",repo:f.repo,runId:f.id}}),{run:f,jobs:y}=await n({path:"/run",query:R})}catch(w){i.append(N("div",{class:"cihb-error",text:ue(w)}))}W()}});if(z.append(te),L)z.append(N("button",{class:"cihb-btn",type:"button",text:K?"Hide the log":"Failing log",onClick:async()=>{if(K=!K,K&&v===null)try{let w=await n({path:"/log",query:{repo:f.repo,job:L.id}});v=w.text,x=w.truncated}catch(w){v=ue(w)}W()}}));if(z.append(N("button",{class:"cihb-btn",type:"button",text:"Fix with the agent",onClick:()=>{let w=zo({run:f,jobs:y,job:L,log:v,logTruncated:x,mode:"fix"});e.answerBlock(Zo(w.text)).catch(()=>{return})}})),i.append(z),K&&v!==null)i.append(N("pre",{class:"cihb-log",text:`${x?`… (tail of the log)
`:""}${v.slice(-8000)}`}));a()};W()};e.onBlock((T)=>{S(T).catch((R)=>c(ue(R)))})};var $t=document.getElementById("root");if(!$t)throw Error("CI Hub: #root is missing");var or=gt(),rr=!1;or.onReady((e)=>{if(xt(e,document.documentElement),rr)return;rr=!0;try{tr(or,$t)}catch(o){$t.textContent=`CI Hub could not start: ${o instanceof Error?o.message:String(o)}`}});})();

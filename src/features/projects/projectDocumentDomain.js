export const PROJECT_DOCUMENT_KINDS=['project_contract','rendering','contract_change_document']
export const MAX_PROJECT_DOCUMENT_BYTES=50*1024*1024
export const TUS_THRESHOLD_BYTES=6*1024*1024
export const SIGNED_ACCESS_TTL_SECONDS=300
export function sanitizeDisplayFileName(value=''){let s=String(value).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu,'').normalize('NFC'); while(Buffer.byteLength(s)>255)s=Array.from(s).slice(0,-1).join(''); return s}
export function sanitizeVoidReason(value=''){const s=String(value).trim(); if(s.length<1||s.length>500) throw new Error('void reason length'); return s}
const mimeByExt={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.heic':'image/heic','.heif':'image/heif','.pdf':'application/pdf'}
export function validateProjectDocumentFile({documentKind,file}){if(!PROJECT_DOCUMENT_KINDS.includes(documentKind))throw new Error('kind'); if(!file||file.size<1||file.size>MAX_PROJECT_DOCUMENT_BYTES)throw new Error('size'); const name=sanitizeDisplayFileName(file.name); const ext=name.slice(name.lastIndexOf('.')).toLowerCase(); const canonical=mimeByExt[ext]; if(!canonical)throw new Error('extension'); if(!file.type&&['.heic','.heif'].includes(ext))return {name,canonicalContentType:canonical}; if(file.type!==canonical)throw new Error('mime'); return {name,canonicalContentType:canonical}}
export function buildProjectDocumentGroups(rows=[]){const out={}; for(const row of rows){const g=out[row.document_kind]??={versions:[]}; g.versions.push(row)} for(const g of Object.values(out)){g.versions.sort((a,b)=>a.version-b.version); g.active=[...g.versions].filter(x=>x.status==='active').sort((a,b)=>b.version-a.version)[0]; g.nextVersion=(g.versions.at(-1)?.version||0)+1} return out}

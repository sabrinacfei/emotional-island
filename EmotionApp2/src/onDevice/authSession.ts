export const AUTH_SESSION_KEY='emotionalIsland.auth.v1';
export type AuthSession={token:string;username:string;avatar:string};
export interface SessionStorage{getItemAsync(key:string):Promise<string|null>;setItemAsync(key:string,value:string):Promise<void>;deleteItemAsync(key:string):Promise<void>}
export async function restoreSession(store:SessionStorage):Promise<AuthSession|null>{
 const raw=await store.getItemAsync(AUTH_SESSION_KEY);if(!raw)return null;
 try{const value=JSON.parse(raw);if(typeof value.token==='string'&&value.token.trim()&&typeof value.username==='string'&&value.username.trim())return {token:value.token,username:value.username,avatar:typeof value.avatar==='string'?value.avatar:'boy'};}catch{}
 await store.deleteItemAsync(AUTH_SESSION_KEY);return null;
}
export async function persistSession(store:SessionStorage,session:AuthSession){
 if(!session.token||!session.username)throw Error('Incomplete login session');
 await store.setItemAsync(AUTH_SESSION_KEY,JSON.stringify(session));
}
export const clearSession=(store:SessionStorage)=>store.deleteItemAsync(AUTH_SESSION_KEY);

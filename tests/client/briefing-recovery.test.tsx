import React from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderHook, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { QUERY_KEYS } from '@/constants/apiRoutes';
jest.unstable_mockModule('@/utils/co-pilot-helpers',()=>({getAuthHeader:()=>({Authorization:'Bearer synthetic'}),subscribeBriefingReady:()=>()=>{}}));
const { useBriefingQueries } = await import('@/hooks/useBriefingQueries');
const clients: QueryClient[]=[];
const pending = () => ({snapshot_id:'fixture',briefing:{weather:{current:null,_pending:true},traffic:{_pending:true},news:{items:[],_pending:true},events:{items:[],marketEvents:[],_pending:true},school_closures:{items:[],_pending:true},airport_conditions:{_pending:true},holiday:{_pending:true}}});
const complete = () => { const value=pending(); Object.values(value.briefing).forEach(section=>{section._pending=false;});return value; };
function response(body:unknown,status=200) {return {ok:status>=200&&status<300,status,json:async()=>body} as Response;}
async function tick(ms=0) {await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});}
function mount() {const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});clients.push(client);const hook=renderHook(({snapshotId})=>useBriefingQueries({snapshotId,isAuthenticated:true}),{initialProps:{snapshotId:'fixture'},wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});return {client,...hook};}
beforeEach(()=>{localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN,'synthetic');jest.useFakeTimers();global.fetch=jest.fn<typeof fetch>();jest.spyOn(console,'log').mockImplementation(()=>{});jest.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());window.dispatchEvent(new CustomEvent('vecto-auth-error'));jest.restoreAllMocks();jest.useRealTimers();localStorage.clear();});
describe('briefing retry lifecycle without SSE',()=>{
 it('continues polling all-pending and partially-complete rows, then stops at verified empty',async()=>{
  const partial=pending();partial.briefing.weather._pending=false;
  jest.mocked(fetch).mockResolvedValueOnce(response(pending())).mockResolvedValueOnce(response(partial)).mockResolvedValue(response(complete()));
  const {result}=mount();await tick();expect(result.current.isLoading.traffic).toBe(true);
  await tick(2000);expect(fetch).toHaveBeenCalledTimes(2);expect(result.current.isLoading.traffic).toBe(true);
  await tick(2000);await tick(1);expect(fetch).toHaveBeenCalledTimes(3);expect(result.current.isLoading.traffic).toBe(false);
  await tick(60000);expect(fetch).toHaveBeenCalledTimes(3);
 });
 it.each(['500','network'])('bounds and backs off repeated %s failures',async mode=>{
  if(mode==='network')jest.mocked(fetch).mockRejectedValue(new Error('synthetic offline'));else jest.mocked(fetch).mockResolvedValue(response({},500));
  const {client,result}=mount();await tick();expect(fetch).toHaveBeenCalledTimes(1);
  await tick(2000);expect(fetch).toHaveBeenCalledTimes(1);
  await tick(2000);expect(fetch).toHaveBeenCalledTimes(2);
  await tick(600000);expect(fetch).toHaveBeenCalledTimes(12);expect(result.current.isUnavailable.events).toBe(true);
  jest.mocked(fetch).mockResolvedValue(response(complete()));
  await act(async()=>{await client.refetchQueries({queryKey:QUERY_KEYS.BRIEFING_AGGREGATE('fixture')});});await tick();
  expect(result.current.isUnavailable.events).toBe(false);expect(result.current.isLoading.events).toBe(false);
 });
 it('dispatches ownership recovery once, stops the stale snapshot, and accepts a new one',async()=>{
  const ownershipError=jest.fn();
  window.addEventListener('snapshot-ownership-error',ownershipError);
  try {
   jest.mocked(fetch).mockResolvedValueOnce(response({error:'snapshot_not_found'},404)).mockResolvedValue(response({...complete(),snapshot_id:'replacement'}));
   const {rerender,result}=mount();await tick();
   expect(ownershipError).toHaveBeenCalledTimes(1);
   await tick(30000);expect(fetch).toHaveBeenCalledTimes(1);
   act(()=>{window.dispatchEvent(new CustomEvent('vecto-snapshot-saved',{detail:{snapshotId:'replacement'}}));});
   rerender({snapshotId:'replacement'});await tick();await tick(1);
   expect(fetch).toHaveBeenCalledTimes(2);
   expect(fetch).toHaveBeenLastCalledWith('/api/briefing/snapshot/replacement',expect.any(Object));
   expect(result.current.isLoading.events).toBe(false);
   expect(ownershipError).toHaveBeenCalledTimes(1);
  } finally {window.removeEventListener('snapshot-ownership-error',ownershipError);}
 });
 it('retries a briefing-not-generated 404 without triggering GPS ownership recovery',async()=>{
  const ownershipError=jest.fn();window.addEventListener('snapshot-ownership-error',ownershipError);
  try {
   jest.mocked(fetch).mockResolvedValueOnce(response({error:'briefing_not_generated'},404)).mockResolvedValue(response(complete()));
   const {result}=mount();await tick();expect(ownershipError).not.toHaveBeenCalled();
   await tick(4000);await tick(1);expect(fetch).toHaveBeenCalledTimes(2);
   expect(result.current.isLoading.events).toBe(false);
  } finally {window.removeEventListener('snapshot-ownership-error',ownershipError);}
 });
});

const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r; }); return { promise, resolve }; };
it.each([401,404])('a late %s JSON body cannot invalidate a newer sign-in',async status=>{
 const body = deferred();
 const authError=jest.fn(), ownershipError=jest.fn();
 window.addEventListener('vecto-auth-error',authError); window.addEventListener('snapshot-ownership-error',ownershipError);
 try {
  jest.mocked(fetch).mockResolvedValue({ok:false,status,json:()=>body.promise} as Response);
  mount(); await tick();
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN,'new-session');
  await act(async()=>{body.resolve({error:status===401?'unauthorized':'snapshot_not_found'});}); await tick();
  expect(authError).not.toHaveBeenCalled(); expect(ownershipError).not.toHaveBeenCalled();
 } finally { window.removeEventListener('vecto-auth-error',authError); window.removeEventListener('snapshot-ownership-error',ownershipError); }
});
it('a successful body for a different snapshot never becomes the requested briefing',async()=>{
 jest.mocked(fetch).mockResolvedValue(response({...complete(),snapshot_id:'another-driver-snapshot'}));
 const {client}=mount(); await tick();
 const stored=client.getQueryData<any>(QUERY_KEYS.BRIEFING_AGGREGATE('fixture'));
 expect(stored?.snapshot_id).toBe('fixture'); expect(stored?._error).toBe(502);
 expect(stored?.briefing.weather).toBeUndefined();
});
it('polling waits for Holiday after the other six sections have settled',async()=>{
 const partial=complete(); partial.briefing.holiday._pending=true;
 jest.mocked(fetch).mockResolvedValueOnce(response(partial)).mockResolvedValue(response(complete()));
 mount(); await tick(); await tick(4000);
 expect(fetch).toHaveBeenCalledTimes(2);
 await tick(60000); expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(['500','network'])('retains verified same-source data across a transient %s read failure',async mode=>{
 const partial={...pending(),status:'pending',updated_at:'2026-10-05T12:00:00Z'};
 partial.briefing.events.items=[{title:'Previously verified event'}] as never[];
 jest.mocked(fetch).mockResolvedValueOnce(response(partial));
 const {client,result}=mount();await tick();await tick(1);
 if(mode==='network')jest.mocked(fetch).mockRejectedValue(new Error('offline'));else jest.mocked(fetch).mockResolvedValue(response({},500));
 await act(async()=>{await client.refetchQueries({queryKey:QUERY_KEYS.BRIEFING_AGGREGATE('fixture')});});await tick(1);
 expect(result.current.eventsData?.events).toEqual([{title:'Previously verified event'}]);
 expect(result.current.generationError).toBeNull();
 expect(result.current.isRetryExhausted).toBe(false);
});

it('does not retain verified data when the same snapshot key is read with a different session token',async()=>{
 const partial={...pending(),status:'pending',updated_at:'2026-10-05T12:00:00Z'};
 partial.briefing.events.items=[{title:'Previous session private event'}] as never[];
 jest.mocked(fetch).mockResolvedValueOnce(response(partial));
 const {client,result}=mount();await tick();await tick(1);
 localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN,'replacement-session');
 jest.mocked(fetch).mockResolvedValue(response({},500));
 await act(async()=>{await client.refetchQueries({queryKey:QUERY_KEYS.BRIEFING_AGGREGATE('fixture')});});await tick(1);
 expect(result.current.eventsData?.events??[]).toEqual([]);
});

it('does not carry verified rows into a replacement snapshot whose first read fails',async()=>{
 const partial={...pending(),status:'pending',updated_at:'2026-10-05T12:00:00Z'};
 partial.briefing.events.items=[{title:'Old snapshot event'}] as never[];
 jest.mocked(fetch).mockResolvedValueOnce(response(partial));
 const {rerender,result}=mount();await tick();await tick(1);
 jest.mocked(fetch).mockResolvedValue(response({},500));
 rerender({snapshotId:'replacement'});await tick();await tick(1);
 expect(result.current.eventsData?.events??[]).toEqual([]);
 expect(fetch).toHaveBeenLastCalledWith('/api/briefing/snapshot/replacement',expect.any(Object));
});

it('successful pending reads receive a bounded inactivity allowance reset only by saved progress',async()=>{
 let data={...pending(),status:'pending',updated_at:'2026-10-05T12:00:00Z'};
 jest.mocked(fetch).mockImplementation(async()=>response(data));
 const {client,result}=mount();await tick();await tick(1);
 await tick(170000);expect(result.current.isRetryExhausted).toBe(false);
 data={...data,updated_at:'2026-10-05T12:02:50Z'};
 await act(async()=>{await client.refetchQueries({queryKey:QUERY_KEYS.BRIEFING_AGGREGATE('fixture')});});await tick(1);
 await tick(170000);expect(result.current.isRetryExhausted).toBe(false);
 await tick(15000);expect(result.current.isRetryExhausted).toBe(true);
 const count=jest.mocked(fetch).mock.calls.length;await tick(60000);expect(fetch).toHaveBeenCalledTimes(count);
});

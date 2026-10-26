import test from 'node:test';
import assert from 'node:assert/strict';
import { readEditorDraft, writeEditorDraft, isPostEditorDraft, isMomentEditorDraft } from '../src/lib/editor-draft.ts';
function storage(){const items=new Map();return {getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};}
test('moment drafts preserve thumbnail settings and accept legacy drafts',()=>{
 const value={content:'',tags:'',images:['/uploads/a'],location:''};
 const imageCrops={'/uploads/a':{x:0.25,y:0.75,zoom:2,aspectRatio:0.75}};
 assert.equal(isMomentEditorDraft(value),true);
 assert.equal(isMomentEditorDraft({...value,imageCrops}),true);
 assert.equal(isMomentEditorDraft({...value,imageCrops:{'/uploads/a':{...imageCrops['/uploads/a'],zoom:8}}}),false);
 const store=storage();writeEditorDraft(store,'moment:crop',JSON.stringify(value),JSON.stringify({...value,imageCrops}));
 assert.deepEqual(JSON.parse(readEditorDraft(store,'moment:crop').value).imageCrops,imageCrops);
});
test('drafts round-trip with their server baseline, stay separate per editor, and clear when unchanged',()=>{
 const store=storage();const baseline=JSON.stringify({content:'server'}),value=JSON.stringify({content:'unsaved'});
 writeEditorDraft(store,'post:1',baseline,value);assert.equal(readEditorDraft(store,'post:1').value,value);assert.equal(readEditorDraft(store,'post:1').baseline,baseline);assert.equal(readEditorDraft(store,'moment:1'),null);
 writeEditorDraft(store,'post:1',baseline,baseline);assert.equal(readEditorDraft(store,'post:1'),null);
});
test('article drafts validate search fields while accepting older drafts',()=>{
 const old={title:'Title',slug:'title',category:'',tags:'',content:'Body',cover:null,status:'draft',attachments:[],referenceSnapshots:[]};
 assert.equal(isPostEditorDraft(old),true);
 assert.equal(isPostEditorDraft({...old,seoDescription:'Search summary',seoNoindex:true}),true);
 assert.equal(isPostEditorDraft({...old,seoDescription:'x'.repeat(301)}),false);
 assert.equal(isPostEditorDraft({...old,seoNoindex:'false'}),false);
});
test('corrupt or oversized drafts are not recovered and storage failures are observable',()=>{
 const store=storage();store.setItem('x','{');assert.equal(readEditorDraft(store,'x'),null);
 store.setItem('x',JSON.stringify({version:2,savedAt:new Date().toISOString(),value:'{}',baseline:'{}'}));assert.equal(readEditorDraft(store,'x'),null);
 assert.throws(()=>writeEditorDraft(store,'x','{}','x'.repeat(2*1024*1024)),/过大/);
 assert.throws(()=>writeEditorDraft({setItem(){throw new Error('quota');}},'x','{}','changed'),/quota/);
 assert.equal(isMomentEditorDraft({content:'a',tags:'b',location:'c',images:['/uploads/a']}),true);
 assert.equal(isMomentEditorDraft({content:'a',tags:'b',location:'c',images:[null]}),false);
 const post={title:'a',slug:'a',category:'',tags:'',content:'b',cover:null,status:'draft',attachments:[],referenceSnapshots:[]};assert.equal(isPostEditorDraft(post),true);assert.equal(isPostEditorDraft({...post,attachments:[{id:1}]}),false);
});

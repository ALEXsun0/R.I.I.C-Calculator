// Metadata may rebuild ordinary tasks, but retained physical work owns its remaining resources.
import type {MowerSchedulingData} from './mowerSchedulingData'
import {MOWER_TASK_TYPES as T,type MowerTask} from './mowerTaskQueue'
import {alphaPosition} from './mowerAlphaDorm'

/** Admit only derived moves independent of failed or resumed remaining arrangements. */
export function admitMowerDerivedTasks(data:MowerSchedulingData,pending:readonly MowerTask[],candidates:MowerTask[]):MowerTask[]{
 const retained=pending.filter(task=>task.retainsExecution)
 if(!retained.length)return candidates
 const names=new Set<string>(),slots=new Set<string>(),groups=new Set<string>()
 const remember=(name:string|undefined)=>{
  if(!name||['Current','Free'].includes(name))return
  names.add(name)
  const op=data.operators[name]
  if(op?.group)groups.add(op.group)
 }
 for(const task of retained){
  Object.keys(task.releaseDormTargets()).forEach(remember)
  for(const [room,row] of Object.entries(task.plan))row.forEach((name,index)=>{
   if(name==='Current'||name==='')return
   slots.add(alphaPosition(room,index));remember(name)
   remember(data.plan[room]?.[index]);if(name==='Free')remember(data.currentOperator(room,index)?.name)
  })
 }
 return candidates.filter(task=>{
  if(task.retainsExecution)return true
  const releases=task.releaseDormTargets(),releasedBySlot=new Map(Object.entries(releases).map(([name,position])=>[alphaPosition(...position),name]))
  for(const [room,row] of Object.entries(task.plan)){
   row.forEach((name,index)=>{
    if(name==='Current'||name==='')return
    const slot=alphaPosition(room,index),actor=name==='Free'?releasedBySlot.get(slot)??data.currentOperator(room,index)?.name:name
    if(slots.has(slot)||actor!==undefined&&(names.has(actor)||!!data.operators[actor]?.group&&groups.has(data.operators[actor]!.group)))row[index]='Current'
   })
   if(row.every(name=>name==='Current'||name===''))delete task.plan[room]
  }
  if(task.type===T.RELEASE_DORM){
   task.releaseTargets=Object.fromEntries(Object.entries(releases).filter(([, [room,index]])=>task.plan[room]?.[index]==='Free'))
   task.metadata=Object.keys(task.releaseTargets).join(',')
  }
  return Object.keys(task.plan).length>0
 })
}

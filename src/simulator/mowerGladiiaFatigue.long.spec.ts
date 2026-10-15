import {readFileSync} from 'node:fs'
import {expect,it} from 'vitest'
import {importMowerJson} from '../workbench/compat/mowerJson'
import {runCalculationBridge} from '../workbench/calculationBridge'
import {MORALE_EPSILON} from '../scheduler/rosterRuntime'

it('keeps the nine-backup legacy roster complete with PR11 recovery and PR12 retained-task scheduling',async()=>{
 // Let Vitest publish the task before entering the synchronous long simulation.
 await new Promise(resolve=>setTimeout(resolve,150))
 const workspace=importMowerJson(readFileSync(new URL('../../validation/mower-backup-2026-09-22/roster.json',import.meta.url),'utf8'))
 const before=structuredClone(workspace)
 const result=runCalculationBridge(workspace,{engine:'simulation',simulationOptions:{
  schedulingModel:'mower-default',warmupHours:72,sampleHours:168,
  warmupModel:'hourly',recordSegments:true,maxEvents:50000,
  production:{outputMode:'potential',runOrderMode:'ideal',droneTarget:'exp',seed:42},
 },simulationAssumptions:{restingThreshold:.65,rescueThreshold:.75,fiammettaThreshold:.9,fiammettaFool:false,freeRoom:false}})
 expect(result.error).toBeUndefined()
 expect(result.simulationReport?.success,JSON.stringify(result.simulationReport?.diagnostics)).toBe(true)
 expect(result.simulationReport?.elapsedHours).toBe(240)
 const gladiia=result.simulationReport!.operators.find(op=>op.operatorId==='char_474_glady')
 expect(gladiia).toBeDefined()
 // PR11 keeps additive dorm recovery; PR12 removes the extra five-minute
 // Fiammetta polling and retains failures until new observations. With this
 // pinned seed, restoring only the old polling planner in an isolated bundle
 // exactly restores 0.007896864444444445h and the old 43-charge timeline.
 // The current mechanism completes the same unchanged 240h input with 39
 // charges; the healthy-provider grant has separate fatigue boundary tests.
 // PR17's additional drone-panel clicks shift the fatigue interval endpoints
 // by 29.276 microseconds in total. Keep the original reference within the
 // simulator's existing hour-boundary epsilon (1e-8 hours = 36 microseconds).
 expect(Math.abs(gladiia!.exhaustedHours-1.4115031240458271)).toBeLessThanOrEqual(MORALE_EPSILON)
 expect(result.simulationReport!.events.filter(event=>event.type==='fiammetta')).toHaveLength(39)
 expect(workspace).toEqual(before)
 expect(workspace.compatibility.backupPlans).toHaveLength(9)
 // Preserve all nine conditions; recovery changes can legitimately prevent a
 // conditional plan from becoming true in this window. Each original trigger
 // has its own false/true execution test in backupPlans.spec.ts.
 const activated=new Set(result.simulationReport!.events.filter(event=>event.type==='backup-plan'&&event.active).map(event=>event.backupIndex))
 expect(activated.has(6)).toBe(true)
 expect(activated.has(8)).toBe(true)
 expect(result.simulationReport!.diagnostics.some(d=>['BACKUP_EXTERNAL_CONDITION_SKIPPED','BACKUP_EXECUTION_FAILED'].includes(d.code))).toBe(false)
 const score=result.report?.summary?.totalScore82
 expect(score).toBeGreaterThanOrEqual(109000)
 expect(score).toBeLessThanOrEqual(109500)
},120000)

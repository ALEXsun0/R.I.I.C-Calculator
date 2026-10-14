import { expect, it, vi } from 'vitest'
import { createDefaultWorkspace } from './defaults'
import { runCalculationBridge } from './calculationBridge'
import type {ScheduleSimulationProgress} from '../simulator/scheduleSimulation'

it('reports actual warmup and sampling progress without changing simulation output', () => {
  const options = { engine: 'simulation' as const, simulationOptions: {
    warmupHours: 1, sampleHours: 2, production: { outputMode: 'potential' as const, droneTarget: 'none' as const, seed: 42 },
  } }
  const progress: { phase: string; elapsedHours: number; totalHours: number }[] = []
  const result = runCalculationBridge(createDefaultWorkspace(), options, p => progress.push(p))
  expect(result.success).toBe(true)
  expect(progress.some(p => p.phase === 'warmup')).toBe(true)
  expect(progress.some(p => p.phase === 'sampling')).toBe(true)
  expect(progress[progress.length - 1]).toMatchObject({ elapsedHours: 3, totalHours: 3 })
  expect(progress.every((p, i) => i === 0 || p.elapsedHours >= progress[i - 1]!.elapsedHours)).toBe(true)
  expect(result).toEqual(runCalculationBridge(createDefaultWorkspace(), options))
})

it('sends wall-clock activity heartbeats while the integer completion percentage stays unchanged',()=>{
 let wall=0
 const clock=vi.spyOn(performance,'now').mockImplementation(()=>wall+=1001)
 try {
  const options={engine:'simulation' as const,simulationOptions:{sampleHours:2,maxStepHours:.001}}
  const progress:ScheduleSimulationProgress[]=[]
  const result=runCalculationBridge(createDefaultWorkspace(),options,p=>progress.push(p))
  expect(result.success).toBe(true)
  expect(progress.some((p,index)=>index>0&&Math.floor(p.elapsedHours/p.totalHours*100)===Math.floor(progress[index-1]!.elapsedHours/progress[index-1]!.totalHours*100))).toBe(true)
  expect(progress.some(p=>p.activity?.capturedHours===p.elapsedHours)).toBe(true)
  expect(result).toEqual(runCalculationBridge(createDefaultWorkspace(),options))
 } finally {clock.mockRestore()}
})

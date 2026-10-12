// Compatibility exports for existing optimizer clients; shared scoring has one owner.
export { scoreProduction, type ProductionScore, type CompletedProduction } from '../domain/productionScore'
export { scoreSimulationProduction } from '../simulator/productionScore'
export type IncomeObjective = 'lmd' | 'exp' | 'composite'

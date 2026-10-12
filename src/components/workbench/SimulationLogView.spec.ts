/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SimulationLogView from './SimulationLogView.vue'
import type { ScheduleSimulationReport } from '../../simulator/scheduleSimulation'
import type { ProductionReport } from '../../simulator/productionTimeline'
import { createLedger } from '../../simulator/resourceLedger'
import { createDroneState } from '../../simulator/droneTimeline'

function createProductionReport(): ProductionReport {
  return {
    success: false,
    ledger: createLedger({}),
    sample: {
      completed: { exp: 0, gold: 0, orderLmd: 0 },
      opening: {}, inflows: {}, outflows: {}, net: {}, closing: {},
    },
    materialsConsumed: {},
    drones: createDroneState(0),
    manufacturing: [],
    trading: [],
    events: [],
    assumptions: {
      outputMode: 'settled', inventoryMode: 'unlimited', seed: 1,
      runOrderMode: 'ideal', droneTarget: 'none', droneReserve: 0,
      collectionIntervalHours: 0.25, orderSnapshotPolicy: 'acquisition-start-v1',
    },
  }
}

function createSampleReport(): ScheduleSimulationReport {
  return {
    schemaVersion: 1,
    engine: 'mower-morale-v1',
    success: true,
    elapsedHours: 48,
    observedHours: 48,
    assumptions: {
      sampleHours: 48,
      warmupHours: 0,
      maxStepHours: 0.25,
      warmupModel: 'continuous',
      restingThreshold: 0.65,
      operationDurationHours: 0,
      dormAtmosphere: '',
      singleRecoveryTarget: '',
    },
    inputs: {
      schedule: {
        schemaVersion: 1,
        rooms: [
          {
            roomId: 'room_1_1',
            type: 'manufacture',
            level: 3,
            capacity: 1,
            slots: [
              {
                roomId: 'room_1_1',
                slotIndex: 0,
                occupant: { kind: 'operator', operatorId: 'char_102_texas' },
                primaryOperatorId: 'char_102_texas',
                orderedCandidates: [],
                groupId: null,
                role: 'work',
              },
            ],
          },
        ],
        operators: {},
        restPools: [],
        policies: {} as any,
        fiammettaPolicies: [],
        runOrderPolicies: [],
      } as any,
      options: {},
    },
    operators: [
      { operatorId: 'char_102_texas', operatorName: '德克萨斯', mainWorkHours: 24, substituteWorkHours: 0, workHours: 24, exhaustedHours: 0, restHours: 24, idleHours: 0, workFraction: 0.5, workRestRatio: 1, initialMorale: 24, finalMorale: 24 },
    ],
    rooms: [
      { roomId: 'room_1_1', roomType: 'manufacture', averageEfficiencyPercent: 130, efficiencyPercentHours: 6240, occupiedHours: 48, teams: [] },
    ],
    events: [
      { time: 24, type: 'shift-off', operators: ['char_102_texas'] },
    ],
    segments: [
      { start: 0, end: 48, occupants: { room_1_1_0: 'char_102_texas' }, bedOccupants: {}, morale: { char_102_texas: 18 }, efficiencyPercent: { room_1_1: 130 } },
    ],
    diagnostics: [],
  }
}

describe('SimulationLogView.vue', () => {
  it('renders empty state when report is null', () => {
    const wrapper = mount(SimulationLogView, {
      props: { report: null },
    })

    expect(wrapper.find('.log-empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无模拟日志数据')
  })

  it('renders report details and ScheduleTimelineGantt when report is passed', () => {
    const wrapper = mount(SimulationLogView, {
      props: { report: createSampleReport() },
    })

    expect(wrapper.find('.log-empty-state').exists()).toBe(false)
    expect(wrapper.find('.status-summary-bar').exists()).toBe(true)
    expect(wrapper.find('[data-test="schedule-timeline-gantt"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('模拟运行过程与计算日志')
    expect(wrapper.text()).toContain('德克萨斯')
    expect(wrapper.find('[data-test="copy-logs-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="export-summary-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="export-full-btn"]').exists()).toBe(true)
  })

  it('starts with a collapsed 24h gantt while keeping image export available', async () => {
    const wrapper = mount(SimulationLogView, {
      props: { report: createSampleReport() },
    })

    const toggle = wrapper.get('[data-test="toggle-gantt-visibility"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="gantt-container"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="export-gantt-btn"]').exists()).toBe(true)

    await wrapper.get('[data-test="export-gantt-btn"]').trigger('click')
    expect(wrapper.find('[data-test="gantt-export-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="download-gantt-btn"]').exists()).toBe(true)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-test="gantt-container"]').exists()).toBe(true)
    expect(wrapper.find('.time-window-info').text()).toContain('T+0.0h 至 T+24.0h')
    wrapper.unmount()
  })

  it('shows sampled manufacturing completions rather than lifetime totals', () => {
    const report = createSampleReport()
    report.production = createProductionReport()
    report.production.manufacturing = [{
      roomId: 'room_1_1', product: 'gold', completedItems: 999, sampleCompletedItems: 7,
      pendingItems: 0, remainingBaseMinutes: 60, blockedHours: 0, blockedMaterialHours: 0,
    }]
    const wrapper = mount(SimulationLogView, { props: { report } })
    const facilityTable = wrapper.findAll('.log-section').find(section => section.text().includes('设施平均效率统计'))
    expect(facilityTable?.text()).toContain('采样完成件数')
    expect(facilityTable?.text()).toContain('7')
    expect(facilityTable?.text()).not.toContain('999')
  })

  it('shows sampled recycle conversions separately from warmup completions and random material value', () => {
    const report = createSampleReport()
    report.rooms.push({ roomId: 'recycle', roomType: 'recycle', averageEfficiencyPercent: 120, efficiencyPercentHours: 5760, occupiedHours: 0, teams: [] })
    report.production = createProductionReport()
    report.production.recycle = {
      roomId: 'recycle', capacity: 10, completedItems: 999, sampleCompletedItems: 3,
      collectedItems: 3, pendingItems: 0, remainingBaseHours: 24, blockedHours: 0,
    }
    const wrapper = mount(SimulationLogView, { props: { report } })
    const table = wrapper.findAll('.log-section').find(section => section.text().includes('设施平均效率统计'))!
    const row = table.findAll('tbody tr').find(item => item.text().includes('回收站'))!
    expect(row.findAll('td')[1]!.text()).toBe('120%')
    expect(row.findAll('td')[3]!.text()).toBe('3')
    expect(table.text()).not.toContain('999')
    expect(row.text()).not.toContain('龙门币')
    wrapper.unmount()
  })

  it('does not report zero conversions when a recycle timer report is unavailable', () => {
    const report = createSampleReport()
    report.rooms.push({ roomId: 'recycle', roomType: 'recycle', averageEfficiencyPercent: 120, efficiencyPercentHours: 5760, occupiedHours: 0, teams: [] })
    const wrapper = mount(SimulationLogView, { props: { report } })
    const table = wrapper.findAll('.log-section').find(section => section.text().includes('设施平均效率统计'))!
    const row = table.findAll('tbody tr').find(item => item.text().includes('回收站'))!
    expect(row.findAll('td')[3]!.text()).toBe('—')
    wrapper.unmount()
  })

  it('triggers lightweight summary export and full debug export on button clicks', async () => {
    const report = createSampleReport()
    const wrapper = mount(SimulationLogView, {
      props: { report },
    })

    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    window.URL.createObjectURL = createObjectURL
    window.URL.revokeObjectURL = revokeObjectURL

    let clickedDownload = ''
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') {
        el.click = () => {
          clickedDownload = (el as HTMLAnchorElement).download
        }
      }
      return el
    })

    await wrapper.find('[data-test="export-summary-btn"]').trigger('click')
    expect(clickedDownload).toContain('基建产出报表_')

    await wrapper.find('[data-test="export-full-btn"]').trigger('click')
    expect(clickedDownload).toContain('基建全量模拟轨迹_')
  })

  it('copies lightweight summary report to clipboard on copy button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText },
    })

    const report = createSampleReport()
    const wrapper = mount(SimulationLogView, {
      props: { report },
    })

    await wrapper.find('[data-test="copy-logs-btn"]').trigger('click')
    expect(writeText).toHaveBeenCalledTimes(1)
    const firstCall = writeText.mock.calls[0]
    expect(firstCall).toBeDefined()
    const copiedJson = JSON.parse(firstCall?.[0] as string)
    expect(copiedJson.segments).toEqual([])
    expect(copiedJson.operators?.[0]?.operatorName).toBe('德克萨斯')
  })
})

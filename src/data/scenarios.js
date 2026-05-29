export const SCENARIOS = {
  'Typhoon Yagi': {
    berthWait: 28,
    inventoryDays: 2.3,
    cargoUrgency: 'Critical',
    rerouteCost: 'Medium',
    cargoType: 'Critical electronics components',
    vesselName: 'MV Sealink Proteus',
    origin: 'Rotterdam',
    alternatePort: 'Port Klang',
    defaultBerthOccupancy: { T1: 74, T2: 81, T3: 100, T4: 87, T5: 52 },
    defaultWaitingCount: 7,
    defaultWaitingVesselNames: ['MV Pacific Trader', 'MV Asian Horizon', 'MV Nordic Star', 'MV Sea Eagle', 'MV Baltic Wind'],
    conflictFlag: 'Weather forecast differs between MPA advisory and vessel AIS feed'
  },
  'Terminal 3 Fire': {
    berthWait: 18,
    inventoryDays: 4.1,
    cargoUrgency: 'High',
    rerouteCost: 'Low',
    cargoType: 'Consumer electronics',
    vesselName: 'MV Horizon Star',
    origin: 'Shenzhen',
    alternatePort: 'Pasir Panjang Terminal',
    defaultBerthOccupancy: { T1: 68, T2: 72, T3: 97, T4: 74, T5: 49 },
    defaultWaitingCount: 4,
    defaultWaitingVesselNames: ['MV Baltic Wind', 'MV Sea Lion', 'MV Eastern Promise'],
    conflictFlag: null
  },
  'Rotterdam Supplier Delay': {
    berthWait: 6,
    inventoryDays: 6.5,
    cargoUrgency: 'Normal',
    rerouteCost: 'Low',
    cargoType: 'Industrial machinery parts',
    vesselName: 'MV Baltic Trader',
    origin: 'Rotterdam',
    alternatePort: 'N/A',
    defaultBerthOccupancy: { T1: 58, T2: 64, T3: 61, T4: 70, T5: 44 },
    defaultWaitingCount: 2,
    defaultWaitingVesselNames: ['MV Eastern Promise'],
    conflictFlag: null
  }
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS)

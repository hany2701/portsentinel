export const SCENARIOS = {
  'Live Data': {
    liveMode: true,
    berthWait: 0,
    inventoryDays: 7,
    cargoUrgency: 'Normal',
    rerouteCost: 'Low',
    cargoType: 'Live AIS feed — no scenario active',
    vesselName: 'N/A',
    origin: 'N/A',
    alternatePort: 'N/A',
    defaultBerthOccupancy: { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 },
    defaultWaitingCount: 0,
    defaultWaitingVesselNames: [],
    conflictFlag: null
  },
  'Typhoon Yagi': {
    berthWait: 28,
    inventoryDays: 2.3,
    cargoUrgency: 'Critical',
    rerouteCost: 'Medium',
    weatherRisk: 'High',
    scenarioWeather: {
      strait:   { wind_kmh: 95, wave_m: 4.5 },
      sgStrait: { wind_kmh: 88, wave_m: 3.8 }
    },
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
    weatherRisk: 'Low',
    scenarioWeather: {
      strait:   { wind_kmh: 18, wave_m: 0.8 },
      sgStrait: { wind_kmh: 14, wave_m: 0.5 }
    },
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
    weatherRisk: 'Low',
    scenarioWeather: {
      strait:   { wind_kmh: 22, wave_m: 1.0 },
      sgStrait: { wind_kmh: 18, wave_m: 0.7 }
    },
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

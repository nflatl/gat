import { getConfigStore } from "../get-config-store"

const mockGetFunction = jest.fn()
const mockSetFunction = jest.fn()

jest.mock(`../get-config-store`, () => {
  return {
    getConfigStore: (): unknown => {
      return {
        items: {},
        set(key: string, value: unknown): void {
          mockSetFunction(key, value)
          ;(this as any).items[key] = value
        },
        get(key: string): unknown {
          mockGetFunction(key)
          return (this as any).items[key]
        },

        __reset(): void {
          ;(this as any).items = {}
        },
      }
    },
  }
})

let isTrackingEnabled

describe(`isTrackingEnabled`, () => {
  beforeEach(() => {
    jest.resetModules()
    isTrackingEnabled = require(`../tracking`).isTrackingEnabled
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it(`is enabled by default`, async () => {
    const enabled = isTrackingEnabled()
    expect(enabled).toBe(true)
    expect(mockGetFunction).toHaveBeenCalledWith(`telemetry.enabled`)
    expect(mockSetFunction).toHaveBeenCalledWith(`telemetry.enabled`, true)
  })

  // TODO - Implement remaining tests

  it.skip(`respects the setting of the config store`, async () => {
    const store = getConfigStore()
    store.set(`telemetry.enabled`, false)
    const enabled = isTrackingEnabled()
    expect(enabled).toBe(false)
  })

  it.skip(`respects the setting of the environment variable`, async () => {})

  it.skip(`caches the setting for all calls in create-gatsby`, async () => {})
})

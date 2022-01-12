import { featuresReducer } from "../reducers/features"

import { actions } from "../actions"

describe(`Features actions`, () => {
  it(`should allow us to enable a feature`, () => {
    expect(featuresReducer({}, actions.toggleFeature(`foo`, true)))
      .toMatchInlineSnapshot(`
      Object {
        "foo": true,
      }
    `)
  })

  it(`should allow us to disable a feature`, () => {
    expect(featuresReducer({}, actions.toggleFeature(`foo`, false)))
      .toMatchInlineSnapshot(`
      Object {
        "foo": false,
      }
    `)
  })

  it(`should not be able to toggle a feature if another plugin already changed it`, () => {
    const state = featuresReducer(
      undefined,
      actions.toggleFeature(`imageService`, true)
    )
    expect(
      featuresReducer(state, actions.toggleFeature(`imageService`, false))
    ).toEqual(
      expect.objectContaining({
        imageService: true,
      })
    )
  })
})

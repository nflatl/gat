import _ from "lodash"
import crypto from "crypto"
import fs from "fs-extra"
import path from "path"

import { store } from "../../redux"
import { IGatsbyState } from "../../redux/types"
import * as nodeAPIs from "../../utils/api-node-docs"
import * as browserAPIs from "../../utils/api-browser-docs"
import ssrAPIs from "../../../cache-dir/api-ssr-docs"
import { getCache } from "../../utils/get-cache"
import { loadPlugins as loadPluginsInternal } from "./load"
import createPluginDependencyDigest from "./create-plugin-dependency-digest"
import {
  collatePluginAPIs,
  handleBadExports,
  handleMultipleReplaceRenderers,
  ExportType,
  ICurrentAPIs,
  validateConfigPluginsOptions,
} from "./validate"
import {
  IPluginInfo,
  IFlattenedPlugin,
  ISiteConfig,
  IRawSiteConfig,
} from "./types"
import { IPluginRefObject, PluginRef } from "gatsby-plugin-utils/dist/types"

const cache = getCache(`bootstrap/load-plugins`)

const getAPI = (
  api: { [exportType in ExportType]: { [api: string]: boolean } }
): ICurrentAPIs =>
  _.keys(api).reduce<Partial<ICurrentAPIs>>((merged, key) => {
    merged[key] = _.keys(api[key])
    return merged
  }, {}) as ICurrentAPIs

// Create a "flattened" array of plugins with all subplugins
// brought to the top-level. This simplifies running gatsby-* files
// for subplugins.
const flattenPlugins = (plugins: Array<IPluginInfo>): Array<IPluginInfo> => {
  const flattened: Array<IPluginInfo> = []
  const extractPlugins = (plugin: IPluginInfo): void => {
    if (plugin.subPluginPaths) {
      for (const subPluginPath of plugin.subPluginPaths) {
        // @pieh:
        // subPluginPath can look like someOption.randomFieldThatIsMarkedAsSubplugins
        // Reason for doing stringified path with . separator was that it was just easier to prevent duplicates
        // in subPluginPaths array (as each subplugin in the gatsby-config would add subplugin path).
        const segments = subPluginPath.split(`.`)
        let roots: Array<any> = [plugin.pluginOptions]
        for (const segment of segments) {
          if (segment === `[]`) {
            roots = roots.flat()
          } else {
            roots = roots.map(root => root[segment])
          }
        }

        roots.forEach(subPlugin => {
          flattened.push(subPlugin)
          extractPlugins(subPlugin)
        })
      }
    }
  }

  plugins.forEach(plugin => {
    flattened.push(plugin)
    extractPlugins(plugin)
  })

  return flattened
}

function normalizePlugin(plugin): IPluginRefObject {
  if (typeof plugin === `string`) {
    return {
      resolve: plugin,
      options: {},
    }
  }

  if (plugin.options?.plugins) {
    plugin.options = {
      ...plugin.options,
      plugins: normalizePlugins(plugin.options.plugins),
    }
  }

  return plugin
}

function normalizePlugins(plugins?: Array<PluginRef>): Array<IPluginRefObject> {
  return (plugins || []).map(normalizePlugin)
}

const normalizeConfig = (config: IRawSiteConfig = {}): ISiteConfig => {
  return {
    ...config,
    plugins: (config.plugins || []).map(normalizePlugin),
  }
}

export async function loadPlugins(
  rawConfig: IRawSiteConfig = {},
  rootDir: string
): Promise<Array<IFlattenedPlugin>> {
  console.time(`loadPlugins`)
  // Turn all strings in plugins: [`...`] into the { resolve: ``, options: {} } form
  const config = normalizeConfig(rawConfig)

  // Show errors for invalid plugin configuration
  await validateConfigPluginsOptions(config, rootDir)

  const currentAPIs = getAPI({
    browser: browserAPIs,
    node: nodeAPIs,
    ssr: ssrAPIs,
  })

  // Collate internal plugins, site config plugins, site default plugins
  const pluginInfos = loadPluginsInternal(config, rootDir)

  // Create a flattened array of the plugins
  const pluginArray = flattenPlugins(pluginInfos)

  // Work out which plugins use which APIs, including those which are not
  // valid Gatsby APIs, aka 'badExports'
  const x = collatePluginAPIs({ currentAPIs, flattenedPlugins: pluginArray })

  // From this point on, these are fully-resolved plugins.
  let flattenedPlugins = x.flattenedPlugins
  const badExports = x.badExports

  // Show errors for any non-Gatsby APIs exported from plugins
  await handleBadExports({ currentAPIs, badExports })

  // Show errors when ReplaceRenderer has been implemented multiple times
  flattenedPlugins = handleMultipleReplaceRenderers({
    flattenedPlugins,
  })

  console.time(`create dependency digests`)
  // process.exit()
  const lastPlugins = await cache.get(`site-flattened-plugins`)
  console.log(`lastPlugins.length`, lastPlugins.length)
  const flattenedPluginsWithDigests = await Promise.all(
    flattenedPlugins.map((p, i) =>
      createPluginDependencyDigest(rootDir, p, i).then(digest => {
        const shasum = crypto.createHash(`sha1`)
        shasum.update(digest.digest)
        // Plugin id is composed of the plugin name + options so is guerenteed
        // to be unique / plugin instance.
        shasum.update(p.id)
        const pluginDigest = shasum.digest(`hex`)

        // Check if the plugin digest has changed since last time.
        let hasChanged = true
        const lastPlugin = lastPlugins.find(lp => lp.id === p.id)
        if (lastPlugin) {
          hasChanged = lastPlugin.digest !== pluginDigest
        }

        return { ...p, hasChanged, digest: pluginDigest }
      })
    )
  )
  console.timeEnd(`create dependency digests`)

  // Filter plugins down to those that have changed & implement node APIs.
  const changedPlugins = flattenedPluginsWithDigests
    .filter(p => p.hasChanged)
    .filter(p => p.nodeAPIs.length > 0)

  console.log(changedPlugins)

  changedPlugins.forEach(async plugin => {
    // Clear its caches
    // cache 1: key/value store
    await fs.emptyDir(path.join(rootDir, `.cache`, `caches`, plugin.name))
    // TODO probably for next two, need to set as flag so when redux is loaded
    // it takes care of deleting stuff
    // cache 2: plugin status
    // cache 3: nodes

    // TODO this is a flag too but after nodes are loaded and before sourceNodes
    // it calls onCreateNode for any plugin that's changed but has parent nodes.
    // I guess when deleting nodes we'd need to track the list of parent nodes
    // and then replay that list.
    //
    // replay any parent nodes.
  })

  await cache.set(`site-flattened-plugins`, flattenedPluginsWithDigests)

  // If we get this far, everything looks good. Update the store
  store.dispatch({
    type: `SET_SITE_FLATTENED_PLUGINS`,
    payload: flattenedPluginsWithDigests as IGatsbyState["flattenedPlugins"],
  })

  console.timeEnd(`loadPlugins`)
  process.exit()
  return flattenedPluginsWithDigests
}

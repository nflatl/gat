const { exec } = require(`child_process`)
const { createRequire } = require(`module`)

module.exports = async function getSharpInstance(): Promise<
  typeof import("sharp")
> {
  try {
    return importSharp()
  } catch (err) {
    await rebuildSharp()

    // Try importing again now we have rebuilt sharp
    return importSharp()
  }
}

function importSharp(): typeof import("sharp") {
  const cleanRequire = createRequire(__filename)
  const sharp = cleanRequire(`sharp`)

  sharp.simd(true)
  // Concurrency is handled by gatsby
  sharp.concurrency(1)

  return sharp
}

function rebuildSharp(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `npm rebuild sharp`,
      {
        timeout: 60 * 1000,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            console.log(`timeout reached`)
          }

          return reject(stderr)
        }

        return setImmediate(() => resolve(stdout))
      }
    )
  })
}

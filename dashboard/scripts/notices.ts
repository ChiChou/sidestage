import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

// Include runtime dependencies and copied components, fonts, and styles.
export function notices(): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle(_options, bundle) {
      const roots = new Set<string>()
      const addPackage = (filename: string) => {
        let dir = path.dirname(filename.split('?')[0])
        while (dir !== path.dirname(dir)) {
          const manifest = path.join(dir, 'package.json')
          if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name) {
            roots.add(dir)
            return
          }
          dir = path.dirname(dir)
        }
        throw new Error(`Cannot find package for ${filename}`)
      }
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) {
          if (id.includes('/node_modules/') && !id.startsWith('\0')) addPackage(id)
        }
      }
      for (const name of ['@fontsource-variable/geist', 'shadcn', 'tailwindcss', 'tw-animate-css']) {
        addPackage(path.resolve('node_modules', name, 'package.json'))
      }
      const sections = [...roots].sort().map((dir) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        const licenses = fs.readdirSync(dir).filter((name) => /^(licen[cs]e|notice)(\..*)?$/i.test(name))
        const fallback = path.resolve('licenses', `${pkg.name.replaceAll('/', '__')}-${pkg.version}.txt`)
        if (!licenses.length && !fs.existsSync(fallback)) throw new Error(`Missing license text for ${pkg.name}`)
        return [
          `${pkg.name} ${pkg.version} (${pkg.license})`,
          ...licenses.sort().map((name) => fs.readFileSync(path.join(dir, name), 'utf8')),
          ...(!licenses.length ? [fs.readFileSync(fallback, 'utf8')] : []),
        ].join('\n\n')
      })
      this.emitFile({
        type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt',
        source: 'SideStage is licensed under the GNU GPL v3 or later; see LICENSE. Third-party software retains its own licenses. Brand names and logos are not granted by the project license.\n\n' + sections.join('\n\n' + '='.repeat(72) + '\n\n'),
      })
      this.emitFile({ type: 'asset', fileName: 'LICENSE', source: fs.readFileSync('../LICENSE', 'utf8') })
    },
  }
}

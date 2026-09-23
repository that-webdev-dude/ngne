import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identities, verifyIdentities } from "../evidence/identity.js";
import type { Prepared, Tree } from "../evidence/schema.js";
import { command, npmPath } from "./process.js";
import type { Run } from "./run.js";
import ts from "typescript";
import { resolve } from "node:path";

/** Check the actual TypeScript resolver, not just a textual import or runtime lookup. */
export function verifyDeclarationResolution(app: string): void {
    const config = ts.readConfigFile(join(app, "tsconfig.json"), ts.sys.readFile);
    if (
        config.error ||
        config.config.extends ||
        config.config.compilerOptions?.paths ||
        config.config.compilerOptions?.baseUrl
    )
        throw Error("Installed fixture must not inherit source aliases");
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
    const resolved = ts.resolveModuleName(
        "ngne",
        join(app, "index.ts"),
        parsed.options,
        ts.sys,
    ).resolvedModule;
    if (
        !resolved ||
        resolve(resolved.resolvedFileName) !==
            resolve(app, "../node_modules/ngne/dist/engine/index.d.ts")
    )
        throw Error("Declarations resolved outside isolated installation");
}

const json = (path: string, value: unknown): void =>
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

/** Install the authored engine-only fixture against the exact packed package. */
export async function installFixture(
    run: Run,
    repository: string,
    pkg: Prepared["package"],
): Promise<Prepared> {
    const installation = join(run.root, "work/installation"),
        app = join(installation, "app");
    mkdirSync(join(installation, "vendor"), { recursive: true });
    cpSync(join(run.root, pkg.path), join(installation, "vendor", pkg.filename));
    json(join(installation, "package.json"), {
        name: "ngne-package-probe",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: { ngne: `file:vendor/${pkg.filename}` },
    });
    const npm = async (name: string, args: string[]) =>
        command(
            run,
            name,
            process.execPath,
            [
                npmPath(),
                ...args,
                "--offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--cache",
                join(run.root, "work/cache"),
            ],
            installation,
        );
    await npm("lock", ["install", "--package-lock-only"]);
    await npm("install", ["ci"]);
    verifyIdentities(join(installation, "node_modules/ngne"), pkg.files);
    cpSync(join(repository, "tooling/fixtures/installed-engine"), app, { recursive: true });
    cpSync(
        join(repository, "node_modules/@webgpu/types/dist/index.d.ts"),
        join(app, "platform.d.ts"),
    );
    json(join(app, "tsconfig.json"), {
        compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: [],
            lib: ["ES2022", "DOM"],
        },
        files: ["index.ts", "api-misuse.ts", "platform.d.ts"],
    });
    writeFileSync(
        join(app, "vite.config.mjs"),
        `import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const app = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\\\', '/');
const installed = resolve(app, '../node_modules/ngne').replaceAll('\\\\', '/') + '/';
export default { build: { emptyOutDir: false, assetsInlineLimit: 0 }, plugins: [{
    name: 'installed-boundary',
    moduleParsed(info) {
        const id = info.id.replaceAll('\\\\', '/');
        if (!id.startsWith('\\0') && !id.startsWith(app) && !id.startsWith(installed))
            throw Error('Module outside installed fixture: ' + id);
    }
}] };
`,
    );
    verifyDeclarationResolution(app);
    json(join(app, "tsconfig.api.json"), {
        compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            types: [],
            lib: ["ES2022", "DOM"],
        },
        files: ["api-misuse.ts"],
    });
    await command(
        run,
        "public-declarations",
        process.execPath,
        [join(repository, "node_modules/typescript/bin/tsc"), "-p", join(app, "tsconfig.api.json")],
        installation,
    );
    await command(
        run,
        "declarations",
        process.execPath,
        [join(repository, "node_modules/typescript/bin/tsc"), "-p", join(app, "tsconfig.json")],
        installation,
    );
    const resolved = await command(
        run,
        "resolution",
        process.execPath,
        ["--input-type=module", "-e", 'console.log(import.meta.resolve("ngne"))'],
        installation,
    );
    const { fileURLToPath } = await import("node:url");
    if (
        fileURLToPath(resolved.trim()) !==
        join(installation, "node_modules/ngne/dist/engine/index.js")
    )
        throw Error("Engine resolved outside isolated installation");
    const build = async (name: "root" | "nested", base: string): Promise<Tree> => {
        const path = `evidence/builds/${name}`;
        await command(
            run,
            `build-${name}`,
            process.execPath,
            [
                join(repository, "node_modules/vite/bin/vite.js"),
                "build",
                app,
                "--config",
                join(app, "vite.config.mjs"),
                "--base",
                base,
                "--outDir",
                join(run.root, path),
            ],
            installation,
        );
        return { path, files: identities(join(run.root, path)) };
    };
    const root = await build("root", "/"),
        nested = await build("nested", "/nested/");
    const dependencyPath = "work/dependencies";
    mkdirSync(join(run.root, dependencyPath));
    for (const file of ["package.json", "package-lock.json"])
        cpSync(join(installation, file), join(run.root, dependencyPath, file));
    return {
        package: pkg,
        installed: {
            path: "work/installation/node_modules/ngne",
            files: identities(join(installation, "node_modules/ngne")),
        },
        workload: { path: "work/installation/app", files: identities(app) },
        dependencies: { path: dependencyPath, files: identities(join(run.root, dependencyPath)) },
        builds: { root, nested },
        toolchain: {
            node: process.version,
            npm: (
                await command(
                    run,
                    "npm-version",
                    process.execPath,
                    [npmPath(), "--version"],
                    repository,
                )
            ).trim(),
            typescript: JSON.parse(
                readFileSync(join(repository, "node_modules/typescript/package.json"), "utf8"),
            ).version,
        },
        dependencyPolicy: "offline-lockfile-ci-no-scripts",
    };
}

const CHUNK_CAPACITY = 512;
const FIELD_VALUE = Symbol("field value");
const SCHEMA_COMPONENT = Symbol("schema component");

export type FieldKind = "f32" | "f64" | "i32" | "u32" | "u8" | "bool" | "entity";

export interface FieldDescriptor<Value, Kind extends FieldKind = FieldKind> {
    readonly kind: Kind;
    readonly default: Value;
    readonly [FIELD_VALUE]: Value;
}

export type SchemaFields = Readonly<Record<string, FieldDescriptor<unknown>>>;
type FieldValue<Field> = Field extends FieldDescriptor<infer Value> ? Value : never;
export type SchemaValues<Fields extends SchemaFields> = {
    [Name in keyof Fields]: FieldValue<Fields[Name]>;
};

function field<Value, Kind extends FieldKind>(
    kind: Kind,
    defaultValue: Value,
): FieldDescriptor<Value, Kind> {
    return Object.freeze({ kind, default: defaultValue, [FIELD_VALUE]: defaultValue });
}

export const f32 = (defaultValue = 0): FieldDescriptor<number, "f32"> =>
    field("f32", validateF32("f32", defaultValue));
export const f64 = (defaultValue = 0): FieldDescriptor<number, "f64"> =>
    field("f64", validateNumber("f64", defaultValue));
export const i32 = (defaultValue = 0): FieldDescriptor<number, "i32"> =>
    field("i32", validateInteger("i32", defaultValue, -0x80000000, 0x7fffffff));
export const u32 = (defaultValue = 0): FieldDescriptor<number, "u32"> =>
    field("u32", validateInteger("u32", defaultValue, 0, 0xffffffff));
export const u8 = (defaultValue = 0): FieldDescriptor<number, "u8"> =>
    field("u8", validateInteger("u8", defaultValue, 0, 0xff));
export const bool = (defaultValue = false): FieldDescriptor<boolean, "bool"> => {
    if (typeof defaultValue !== "boolean") throw new Error("Invalid bool default");
    return field("bool", defaultValue);
};
export function entityRef(): FieldDescriptor<Entity | null, "entity">;
export function entityRef(...defaultValues: unknown[]): FieldDescriptor<Entity | null, "entity"> {
    if (defaultValues.length > 0) throw new Error("Entity reference defaults are always null");
    return field("entity", null);
}

/** Deprecated object-component bridge. NGNE-27 removes it after game migration. */
export class Component<T extends object> {
    constructor(
        readonly name: string,
        readonly create: () => T,
    ) {
        if (!name) throw new Error("Component name required");
    }
    of(value: Partial<T> = {}): ComponentValue<T> {
        return { component: this, value: Object.assign(this.create(), value) };
    }
}

export interface ComponentValue<T extends object = object> {
    readonly component: Component<T>;
    readonly value: T;
}

export class SchemaComponent<Name extends string, Fields extends SchemaFields> {
    readonly [SCHEMA_COMPONENT] = true;
    readonly fields: Fields;
    constructor(
        readonly name: Name,
        fields: Fields,
    ) {
        if (!name) throw new Error("Component name required");
        const cloned: Record<string, FieldDescriptor<unknown>> = Object.create(null);
        for (const [fieldName, descriptor] of Object.entries(fields)) {
            if (!fieldName) throw new Error("Component field name required");
            if (!isFieldDescriptor(descriptor))
                throw new Error(`Invalid field descriptor: ${name}.${fieldName}`);
            const defaultValue = validateDescriptorDefault(`${name}.${fieldName}`, descriptor);
            cloned[fieldName] = Object.freeze({
                kind: descriptor.kind,
                default: defaultValue,
                [FIELD_VALUE]: defaultValue,
            });
        }
        this.fields = Object.freeze(cloned) as Fields;
        Object.freeze(this);
    }
    of(value: Partial<SchemaValues<Fields>> = {}): SchemaComponentValue<Name, Fields> {
        for (const fieldName of Object.keys(value))
            if (!(fieldName in this.fields))
                throw new Error(`Unknown component field: ${this.name}.${fieldName}`);
        return { component: this, value };
    }
}

export interface SchemaComponentValue<Name extends string, Fields extends SchemaFields> {
    readonly component: SchemaComponent<Name, Fields>;
    readonly value: Partial<SchemaValues<Fields>>;
}

export function component<const Name extends string, const Fields extends SchemaFields>(
    name: Name,
    fields: Fields,
): SchemaComponent<Name, Fields>;
export function component<T extends object>(name: string, create: () => T): Component<T>;
export function component(
    name: string,
    definition: (() => object) | SchemaFields,
): Component<object> | SchemaComponent<string, SchemaFields> {
    return typeof definition === "function"
        ? new Component(name, definition)
        : new SchemaComponent(name, definition);
}

export type Entity = Readonly<{ index: number; generation: number; owner: symbol }>;
type AnySchemaComponent = SchemaComponent<string, SchemaFields>;
type AnySchemaValue = SchemaComponentValue<string, SchemaFields>;
type AnyLegacyComponent = Component<object>;
type AnyLegacyValue = ComponentValue<object>;
type AnyComponentValue = AnyLegacyValue | AnySchemaValue;
type LegacyValues<Types extends readonly AnyLegacyComponent[]> = {
    [Index in keyof Types]: Types[Index] extends Component<infer Value> ? Value : never;
};
type FieldColumn<Field> =
    Field extends FieldDescriptor<unknown, "f32">
        ? Float32Array
        : Field extends FieldDescriptor<unknown, "f64">
          ? Float64Array
          : Field extends FieldDescriptor<unknown, "i32">
            ? Int32Array
            : Field extends FieldDescriptor<unknown, "u32">
              ? Uint32Array
              : Field extends FieldDescriptor<unknown, "u8" | "bool">
                ? Uint8Array
                : Field extends FieldDescriptor<unknown, "entity">
                  ? EntityReferenceView
                  : never;

export type SchemaComponentView<Fields extends SchemaFields> = {
    [Name in keyof Fields]: FieldColumn<Fields[Name]>;
};
export type SchemaQueryViews<Types extends readonly AnySchemaComponent[]> = {
    [Type in Types[number] as Type["name"]]: Type extends SchemaComponent<string, infer Fields>
        ? SchemaComponentView<Fields>
        : never;
};
export interface EntityReferenceView {
    readonly index: Uint32Array;
    readonly generation: Uint32Array;
}
export interface SchemaChunk<Types extends readonly AnySchemaComponent[]> {
    readonly count: number;
    readonly capacity: number;
    readonly views: SchemaQueryViews<Types>;
    entityAt(row: number): Entity;
}
export interface Query<Types extends readonly AnyLegacyComponent[]> {
    readonly size: number;
    each(visit: (entity: Entity, ...values: LegacyValues<Types>) => void): void;
}
export interface AllQuery {
    readonly size: number;
    each(visit: (entity: Entity) => void): void;
}
export interface SchemaQuery<Types extends readonly AnySchemaComponent[]> {
    readonly size: number;
    eachChunk(visit: (chunk: SchemaChunk<Types>) => void): void;
}

export interface WorldAccess {
    spawn(): Entity;
    spawn(...values: AnyLegacyValue[]): Entity;
    spawn(...values: AnySchemaValue[]): Entity;
    despawn(entity: Entity): void;
    has(entity: Entity): boolean;
    get<T extends object>(entity: Entity, type: Component<T>): T | undefined;
    read<Name extends string, Fields extends SchemaFields, Field extends keyof Fields>(
        entity: Entity,
        type: SchemaComponent<Name, Fields>,
        field: Field,
    ): FieldValue<Fields[Field]> | undefined;
    write<Name extends string, Fields extends SchemaFields, Field extends keyof Fields>(
        entity: Entity,
        type: SchemaComponent<Name, Fields>,
        field: Field,
        value: FieldValue<Fields[Field]>,
    ): void;
    query(): AllQuery;
    query<Types extends readonly AnyLegacyComponent[]>(...types: Types): Query<Types>;
    query<Types extends readonly AnySchemaComponent[]>(...types: Types): SchemaQuery<Types>;
}

interface Slot {
    generation: number;
    archetype?: Archetype;
    chunk: number;
    row: number;
    pending: boolean;
    handle?: Entity;
}
interface LegacyArchetype {
    readonly mode: "legacy";
    readonly types: AnyLegacyComponent[];
    readonly entities: Entity[];
    readonly columns: object[][];
}
type NumericColumn = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array;
interface EntityReferenceColumn {
    readonly index: Uint32Array;
    readonly generation: Uint32Array;
}
type Column = NumericColumn | EntityReferenceColumn;
type ComponentColumns = Record<string, Column>;
interface SchemaChunkRuntime {
    count: number;
    readonly entities: (Entity | undefined)[];
    readonly columns: ComponentColumns[];
}
interface SchemaArchetype {
    readonly mode: "schema";
    readonly types: AnySchemaComponent[];
    readonly chunks: SchemaChunkRuntime[];
}
type Archetype = LegacyArchetype | SchemaArchetype;
type PendingBirth =
    | { readonly mode: "legacy"; readonly entity: Entity; readonly values: AnyLegacyValue[] }
    | {
          readonly mode: "schema";
          readonly entity: Entity;
          readonly values: { readonly component: AnySchemaComponent; readonly value: object }[];
      };

class LegacyQueryRuntime<Types extends readonly AnyLegacyComponent[]> implements Query<Types> {
    #version = -1;
    #matches: { archetype: LegacyArchetype; columns: object[][] }[] = [];
    readonly #world: World;
    readonly #types: Types;
    constructor(world: World, types: Types) {
        this.#world = world;
        this.#types = types;
        Object.freeze(this);
    }
    get size(): number {
        this.refresh();
        return this.#matches.reduce((size, match) => size + match.archetype.entities.length, 0);
    }
    each(visit: (entity: Entity, ...values: LegacyValues<Types>) => void): void {
        this.refresh();
        this.#world.beginRead();
        try {
            for (const { archetype, columns } of this.#matches) {
                const args: unknown[] = new Array(columns.length + 1);
                for (let row = 0; row < archetype.entities.length; row++) {
                    args[0] = archetype.entities[row];
                    for (let column = 0; column < columns.length; column++)
                        args[column + 1] = columns[column][row];
                    Reflect.apply(visit, undefined, args);
                }
            }
        } finally {
            this.#world.endRead();
        }
    }
    private refresh(): void {
        if (this.#version === this.#world.structureVersion) return;
        this.#matches = this.#world.archetypeList
            .filter(
                (archetype): archetype is LegacyArchetype =>
                    archetype.mode === "legacy" &&
                    this.#types.every((type) => archetype.types.includes(type)),
            )
            .map((archetype) => ({
                archetype,
                columns: this.#types.map(
                    (type) => archetype.columns[archetype.types.indexOf(type)],
                ),
            }));
        this.#version = this.#world.structureVersion;
    }
}

class AllQueryRuntime implements AllQuery {
    readonly #world: World;
    constructor(world: World) {
        this.#world = world;
        Object.freeze(this);
    }
    get size(): number {
        return this.#world.size;
    }
    each(visit: (entity: Entity) => void): void {
        this.#world.beginRead();
        try {
            for (const archetype of this.#world.archetypeList) {
                if (archetype.mode === "legacy")
                    for (const entity of archetype.entities) visit(entity);
                else
                    for (const chunk of archetype.chunks)
                        for (let row = 0; row < chunk.count; row++) visit(chunk.entities[row]!);
            }
        } finally {
            this.#world.endRead();
        }
    }
}

class SchemaQueryRuntime<
    Types extends readonly AnySchemaComponent[],
> implements SchemaQuery<Types> {
    #version = -1;
    #matches: SchemaArchetype[] = [];
    #borrowEpoch = -1;
    #descriptors: SchemaChunk<Types>[] = [];
    readonly #world: World;
    readonly #types: Types;
    constructor(world: World, types: Types) {
        this.#world = world;
        this.#types = types;
        Object.freeze(this);
    }
    get size(): number {
        this.refresh();
        return this.#matches.reduce(
            (size, archetype) =>
                size + archetype.chunks.reduce((rows, chunk) => rows + chunk.count, 0),
            0,
        );
    }
    eachChunk(visit: (chunk: SchemaChunk<Types>) => void): void {
        this.refresh();
        this.refreshDescriptors();
        this.#world.beginRead();
        try {
            for (const descriptor of this.#descriptors) if (descriptor.count > 0) visit(descriptor);
        } finally {
            this.#world.endRead();
        }
    }
    private refresh(): void {
        if (this.#version === this.#world.structureVersion) return;
        this.#matches = this.#world.archetypeList.filter(
            (archetype): archetype is SchemaArchetype =>
                archetype.mode === "schema" &&
                this.#types.every((type) => archetype.types.includes(type)),
        );
        this.#version = this.#world.structureVersion;
        this.#borrowEpoch = -1;
    }
    private refreshDescriptors(): void {
        if (this.#borrowEpoch === this.#world.commitEpoch) return;
        const epoch = this.#world.commitEpoch;
        this.#descriptors = this.#matches.flatMap((archetype) =>
            archetype.chunks.map((chunk) =>
                createChunkDescriptor(this.#world, epoch, archetype, chunk, this.#types),
            ),
        );
        this.#borrowEpoch = epoch;
    }
}

Object.freeze(LegacyQueryRuntime.prototype);
Object.freeze(AllQueryRuntime.prototype);
Object.freeze(SchemaQueryRuntime.prototype);

class WorldAccessRuntime implements WorldAccess {
    readonly #world: World;
    constructor(world: World) {
        this.#world = world;
        defineOpaque(this, {
            spawn: this.spawn.bind(this),
            despawn: this.despawn.bind(this),
            has: this.has.bind(this),
            get: this.get.bind(this),
            read: this.read.bind(this),
            write: this.write.bind(this),
            query: this.query.bind(this),
        });
    }
    spawn(): Entity;
    spawn(...values: AnyLegacyValue[]): Entity;
    spawn(...values: AnySchemaValue[]): Entity;
    spawn(...values: AnyComponentValue[]): Entity {
        return this.#world.spawnValues(values);
    }
    despawn(entity: Entity): void {
        this.#world.despawn(entity);
    }
    has(entity: Entity): boolean {
        return this.#world.has(entity);
    }
    get<T extends object>(entity: Entity, type: Component<T>): T | undefined {
        return this.#world.get(entity, type);
    }
    read<Name extends string, Fields extends SchemaFields, Field extends keyof Fields>(
        entity: Entity,
        type: SchemaComponent<Name, Fields>,
        field: Field,
    ): FieldValue<Fields[Field]> | undefined {
        return this.#world.read(entity, type, field);
    }
    write<Name extends string, Fields extends SchemaFields, Field extends keyof Fields>(
        entity: Entity,
        type: SchemaComponent<Name, Fields>,
        field: Field,
        value: FieldValue<Fields[Field]>,
    ): void {
        this.#world.write(entity, type, field, value);
    }
    query(): AllQuery;
    query<Types extends readonly AnyLegacyComponent[]>(...types: Types): Query<Types>;
    query<Types extends readonly AnySchemaComponent[]>(...types: Types): SchemaQuery<Types>;
    query(
        ...types: (AnyLegacyComponent | AnySchemaComponent)[]
    ): AllQuery | Query<AnyLegacyComponent[]> | SchemaQuery<AnySchemaComponent[]> {
        return this.#world.queryTypes(types);
    }
}

Object.freeze(WorldAccessRuntime.prototype);

export class World implements WorldAccess {
    private readonly owner = Symbol("world");
    private readonly slots: Slot[] = [];
    private readonly free: number[] = [];
    private readonly archetypes: Archetype[] = [];
    private readonly births: PendingBirth[] = [];
    private readonly deaths = new Set<Entity>();
    private readonly definitions = new Map<string, AnyLegacyComponent | AnySchemaComponent>();
    private reading = 0;
    private disposed = false;
    private structuralVersion = 0;
    private epoch = 0;
    readonly access: WorldAccess;
    constructor() {
        this.access = new WorldAccessRuntime(this);
    }
    get archetypeList(): readonly Archetype[] {
        return this.archetypes;
    }
    get structureVersion(): number {
        return this.structuralVersion;
    }
    get commitEpoch(): number {
        return this.epoch;
    }
    get size(): number {
        return this.archetypes.reduce(
            (size, archetype) =>
                size +
                (archetype.mode === "legacy"
                    ? archetype.entities.length
                    : archetype.chunks.reduce((rows, chunk) => rows + chunk.count, 0)),
            0,
        );
    }
    get capacity(): number {
        return this.slots.length;
    }
    beginRead(): void {
        this.reading++;
    }
    endRead(): void {
        this.reading--;
    }
    spawn(): Entity;
    spawn(...values: AnyLegacyValue[]): Entity;
    spawn(...values: AnySchemaValue[]): Entity;
    spawn(...values: AnyComponentValue[]): Entity {
        return this.spawnValues(values);
    }
    spawnValues(values: AnyComponentValue[]): Entity {
        if (this.disposed) throw new Error("World is disposed");
        const mode = getValueMode(values);
        if (new Set(values.map((value) => value.component)).size !== values.length)
            throw new Error("Duplicate component");
        const lowered =
            mode === "schema"
                ? values.map((entry) => {
                      const schemaValue = entry as AnySchemaValue;
                      return {
                          component: schemaValue.component,
                          value: this.lowerSchemaValue(schemaValue.component, schemaValue.value),
                      };
                  })
                : [];
        for (const { component: type } of values) this.registerDefinition(type);
        const index = this.free.pop() ?? this.slots.length;
        const slot = this.slots[index] ?? { generation: 0, chunk: -1, row: -1, pending: true };
        slot.pending = true;
        this.slots[index] = slot;
        const entity = Object.freeze({ index, generation: slot.generation, owner: this.owner });
        slot.handle = entity;
        if (mode === "schema") this.births.push({ mode, entity, values: lowered });
        else this.births.push({ mode, entity, values: values as AnyLegacyValue[] });
        return entity;
    }
    private registerDefinition(type: AnyLegacyComponent | AnySchemaComponent): void {
        const existing = this.definitions.get(type.name);
        if (existing && existing !== type)
            throw new Error(`Conflicting component identity: ${type.name}`);
        this.definitions.set(type.name, type);
    }
    private lowerSchemaValue(type: AnySchemaComponent, partial: object): object {
        const value: Record<string, unknown> = Object.create(null);
        for (const fieldName of Object.keys(partial))
            if (!(fieldName in type.fields))
                throw new Error(`Unknown component field: ${type.name}.${fieldName}`);
        for (const [fieldName, descriptor] of Object.entries(type.fields)) {
            const candidate = Object.prototype.hasOwnProperty.call(partial, fieldName)
                ? Reflect.get(partial, fieldName)
                : undefined;
            const authored = candidate === undefined ? descriptor.default : candidate;
            value[fieldName] = this.validateField(type, fieldName, descriptor, authored);
        }
        return value;
    }
    private validateField(
        type: AnySchemaComponent,
        fieldName: string,
        descriptor: FieldDescriptor<unknown>,
        value: unknown,
    ): unknown {
        const label = `${type.name}.${fieldName}`;
        switch (descriptor.kind) {
            case "f32":
                return validateF32(label, value);
            case "f64":
                return validateNumber(label, value);
            case "i32":
                return validateInteger(label, value, -0x80000000, 0x7fffffff);
            case "u32":
                return validateInteger(label, value, 0, 0xffffffff);
            case "u8":
                return validateInteger(label, value, 0, 0xff);
            case "bool":
                if (typeof value !== "boolean") throw new Error(`Invalid boolean: ${label}`);
                return value;
            case "entity":
                if (value === null) return null;
                if (!isEntity(value)) throw new Error(`Invalid entity reference: ${label}`);
                if (value.owner !== this.owner)
                    throw new Error(`Foreign entity reference: ${label}`);
                const slot = this.slots[value.index];
                if (
                    !slot ||
                    value.generation > slot.generation ||
                    (value.generation === slot.generation && !slot.archetype && !slot.pending)
                )
                    throw new Error(`Unknown entity reference: ${label}`);
                if (value.index + 1 > 0xffffffff || value.generation > 0xffffffff)
                    throw new Error(`Entity reference exceeds uint32 storage: ${label}`);
                return value;
        }
    }
    private slot(entity: Entity): Slot | undefined {
        const slot = this.slots[entity.index];
        return entity.owner === this.owner && slot?.generation === entity.generation
            ? slot
            : undefined;
    }
    has(entity: Entity): boolean {
        return !!this.slot(entity)?.archetype;
    }
    get<T extends object>(entity: Entity, type: Component<T>): T | undefined {
        if (isSchemaComponent(type)) throw new Error("Schema components use read() and write()");
        const slot = this.slot(entity);
        if (!slot?.archetype || slot.archetype.mode !== "legacy") return undefined;
        const column = slot.archetype.columns[slot.archetype.types.indexOf(type)];
        return column?.[slot.row] as T | undefined;
    }
    read<Name extends string, Fields extends SchemaFields, Field extends keyof Fields>(
        entity: Entity,
        type: SchemaComponent<Name, Fields>,
        fieldName: Field,
    ): FieldValue<Fields[Field]> | undefined {
        const descriptor = this.requireField(type, fieldName);
        const slot = this.slot(entity);
        if (!slot?.archetype || slot.archetype.mode !== "schema") return undefined;
        const typeIndex = slot.archetype.types.indexOf(type);
        if (typeIndex < 0) return undefined;
        const column = slot.archetype.chunks[slot.chunk].columns[typeIndex][String(fieldName)];
        return this.readColumn(column, descriptor, slot.row) as FieldValue<Fields[Field]>;
    }
    write<Name extends string, Fields extends SchemaFields, Field extends keyof Fields>(
        entity: Entity,
        type: SchemaComponent<Name, Fields>,
        fieldName: Field,
        value: FieldValue<Fields[Field]>,
    ): void {
        const descriptor = this.requireField(type, fieldName);
        const validated = this.validateField(type, String(fieldName), descriptor, value);
        const slot = this.slot(entity);
        if (!slot?.archetype || slot.archetype.mode !== "schema") return;
        const typeIndex = slot.archetype.types.indexOf(type);
        if (typeIndex < 0) return;
        writeColumn(
            slot.archetype.chunks[slot.chunk].columns[typeIndex][String(fieldName)],
            descriptor.kind,
            slot.row,
            validated,
        );
    }
    private requireField(
        type: AnySchemaComponent,
        fieldName: PropertyKey,
    ): FieldDescriptor<unknown> {
        if (!isSchemaComponent(type)) throw new Error("Schema component required");
        const descriptor = type.fields[String(fieldName)];
        if (!descriptor)
            throw new Error(`Unknown component field: ${type.name}.${String(fieldName)}`);
        return descriptor;
    }
    private readColumn(column: Column, descriptor: FieldDescriptor<unknown>, row: number): unknown {
        if (descriptor.kind === "entity") {
            const reference = column as EntityReferenceColumn,
                encodedIndex = reference.index[row];
            if (encodedIndex === 0) return null;
            const index = encodedIndex - 1,
                generation = reference.generation[row],
                slot = this.slots[index];
            if (slot?.handle?.generation === generation) return slot.handle;
            return Object.freeze({ index, generation, owner: this.owner });
        }
        const encoded = (column as NumericColumn)[row];
        return descriptor.kind === "bool" ? encoded !== 0 : encoded;
    }
    despawn(entity: Entity): void {
        const slot = this.slot(entity);
        if (slot && (slot.archetype || slot.pending)) this.deaths.add(entity);
    }
    query(): AllQuery;
    query<Types extends readonly AnyLegacyComponent[]>(...types: Types): Query<Types>;
    query<Types extends readonly AnySchemaComponent[]>(...types: Types): SchemaQuery<Types>;
    query(
        ...types: (AnyLegacyComponent | AnySchemaComponent)[]
    ): AllQuery | Query<AnyLegacyComponent[]> | SchemaQuery<AnySchemaComponent[]> {
        return this.queryTypes(types);
    }
    queryTypes(
        types: (AnyLegacyComponent | AnySchemaComponent)[],
    ): AllQuery | Query<AnyLegacyComponent[]> | SchemaQuery<AnySchemaComponent[]> {
        if (this.disposed) throw new Error("World is disposed");
        if (types.length === 0) return new AllQueryRuntime(this);
        const schemaCount = types.filter(isSchemaComponent).length;
        if (schemaCount !== 0 && schemaCount !== types.length)
            throw new Error("Cannot mix schema and legacy components in a query");
        if (schemaCount) {
            if (new Set(types).size !== types.length) throw new Error("Duplicate component");
            for (const type of types) this.registerDefinition(type);
            return new SchemaQueryRuntime(this, types as AnySchemaComponent[]);
        }
        return new LegacyQueryRuntime(this, types as AnyLegacyComponent[]);
    }
    commit(): void {
        if (this.reading) throw new Error("Cannot commit during query iteration");
        if (this.disposed) throw new Error("World is disposed");
        this.epoch++;
        for (const birth of this.births)
            if (birth.mode === "legacy") this.commitLegacyBirth(birth);
            else this.commitSchemaBirth(birth);
        this.births.length = 0;
        for (const entity of this.deaths) this.commitDeath(entity);
        this.deaths.clear();
    }
    private commitLegacyBirth(birth: Extract<PendingBirth, { mode: "legacy" }>): void {
        let archetype = this.archetypes.find(
            (candidate): candidate is LegacyArchetype =>
                candidate.mode === "legacy" &&
                candidate.types.length === birth.values.length &&
                birth.values.every((value) => candidate.types.includes(value.component)),
        );
        if (!archetype) {
            archetype = {
                mode: "legacy",
                types: birth.values.map((value) => value.component),
                columns: birth.values.map(() => []),
                entities: [],
            };
            this.archetypes.push(archetype);
            this.structuralVersion++;
        }
        const slot = this.slot(birth.entity)!;
        slot.archetype = archetype;
        slot.chunk = -1;
        slot.pending = false;
        slot.row = archetype.entities.length;
        archetype.entities.push(birth.entity);
        archetype.types.forEach((type, index) =>
            archetype!.columns[index].push(
                birth.values.find((value) => value.component === type)!.value,
            ),
        );
    }
    private commitSchemaBirth(birth: Extract<PendingBirth, { mode: "schema" }>): void {
        let archetype = this.archetypes.find(
            (candidate): candidate is SchemaArchetype =>
                candidate.mode === "schema" &&
                candidate.types.length === birth.values.length &&
                birth.values.every((value) => candidate.types.includes(value.component)),
        );
        if (!archetype) {
            archetype = {
                mode: "schema",
                types: birth.values.map((value) => value.component),
                chunks: [],
            };
            this.archetypes.push(archetype);
            this.structuralVersion++;
        }
        let chunkIndex = archetype.chunks.findIndex((chunk) => chunk.count < CHUNK_CAPACITY);
        if (chunkIndex < 0) {
            archetype.chunks.push(createSchemaChunk(archetype.types));
            chunkIndex = archetype.chunks.length - 1;
            this.structuralVersion++;
        }
        const chunk = archetype.chunks[chunkIndex],
            row = chunk.count++;
        chunk.entities[row] = birth.entity;
        for (let typeIndex = 0; typeIndex < archetype.types.length; typeIndex++) {
            const type = archetype.types[typeIndex],
                value = birth.values.find((entry) => entry.component === type)!.value;
            for (const [fieldName, descriptor] of Object.entries(type.fields))
                writeColumn(
                    chunk.columns[typeIndex][fieldName],
                    descriptor.kind,
                    row,
                    Reflect.get(value, fieldName),
                );
        }
        const slot = this.slot(birth.entity)!;
        slot.archetype = archetype;
        slot.chunk = chunkIndex;
        slot.row = row;
        slot.pending = false;
    }
    private commitDeath(entity: Entity): void {
        const slot = this.slot(entity);
        if (!slot?.archetype) return;
        if (slot.archetype.mode === "legacy") {
            const archetype = slot.archetype,
                last = archetype.entities.length - 1;
            if (slot.row !== last) {
                archetype.entities[slot.row] = archetype.entities[last];
                this.slots[archetype.entities[slot.row].index].row = slot.row;
                for (const column of archetype.columns) column[slot.row] = column[last];
            }
            archetype.entities.pop();
            for (const column of archetype.columns) column.pop();
        } else {
            const archetype = slot.archetype,
                chunk = archetype.chunks[slot.chunk],
                last = chunk.count - 1;
            if (slot.row !== last) {
                const moved = chunk.entities[last]!;
                chunk.entities[slot.row] = moved;
                this.slots[moved.index].row = slot.row;
                for (const columns of chunk.columns)
                    for (const column of Object.values(columns))
                        copyColumnRow(column, last, slot.row);
            }
            chunk.entities[last] = undefined;
            for (const columns of chunk.columns)
                for (const column of Object.values(columns)) clearColumnRow(column, last);
            chunk.count--;
        }
        slot.archetype = undefined;
        slot.chunk = -1;
        slot.row = -1;
        slot.pending = false;
        slot.generation++;
        this.free.push(entity.index);
    }
    enumerate(): object {
        return {
            archetypes: this.archetypes.map((archetype) =>
                archetype.mode === "legacy"
                    ? {
                          components: archetype.types.map((type) => type.name),
                          entities: archetype.entities.map((entity) => entity.index),
                      }
                    : {
                          components: archetype.types.map((type) => type.name),
                          entities: archetype.chunks.flatMap((chunk) =>
                              chunk.entities.slice(0, chunk.count).map((entity) => entity!.index),
                          ),
                          fields: archetype.types.map((type) => ({
                              component: type.name,
                              fields: Object.entries(type.fields).map(([name, descriptor]) => ({
                                  name,
                                  kind: descriptor.kind,
                                  default: inspectFieldValue(descriptor.default),
                              })),
                          })),
                          chunks: archetype.chunks.map((chunk) => ({
                              capacity: CHUNK_CAPACITY,
                              count: chunk.count,
                              entities: chunk.entities
                                  .slice(0, chunk.count)
                                  .map((entity) => entity!.index),
                          })),
                      },
            ),
            slots: this.slots.map((slot) => ({
                generation: slot.generation,
                row: slot.row,
                pending: slot.pending,
                ...(slot.archetype?.mode === "schema" ? { chunk: slot.chunk } : {}),
            })),
            free: [...this.free],
            entities: enumerateEntities(this.archetypes),
        };
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.epoch++;
        this.structuralVersion++;
        this.births.length = 0;
        this.deaths.clear();
        for (const archetype of this.archetypes)
            if (archetype.mode === "legacy") {
                archetype.entities.length = 0;
                for (const column of archetype.columns) column.length = 0;
            } else
                for (const chunk of archetype.chunks) {
                    chunk.count = 0;
                    chunk.entities.fill(undefined);
                    for (const columns of chunk.columns)
                        for (const column of Object.values(columns)) clearColumn(column);
                }
        this.archetypes.length = 0;
        this.slots.length = 0;
        this.free.length = 0;
    }
}

function createSchemaChunk(types: readonly AnySchemaComponent[]): SchemaChunkRuntime {
    return {
        count: 0,
        entities: new Array<Entity | undefined>(CHUNK_CAPACITY),
        columns: types.map((type) =>
            Object.fromEntries(
                Object.entries(type.fields).map(([name, descriptor]) => [
                    name,
                    createColumn(descriptor.kind),
                ]),
            ),
        ),
    };
}
function createColumn(kind: FieldKind): Column {
    switch (kind) {
        case "f32":
            return new Float32Array(CHUNK_CAPACITY);
        case "f64":
            return new Float64Array(CHUNK_CAPACITY);
        case "i32":
            return new Int32Array(CHUNK_CAPACITY);
        case "u32":
            return new Uint32Array(CHUNK_CAPACITY);
        case "u8":
        case "bool":
            return new Uint8Array(CHUNK_CAPACITY);
        case "entity":
            return {
                index: new Uint32Array(CHUNK_CAPACITY),
                generation: new Uint32Array(CHUNK_CAPACITY),
            };
    }
}
function writeColumn(column: Column, kind: FieldKind, row: number, value: unknown): void {
    if (kind === "entity") {
        const reference = column as EntityReferenceColumn;
        if (value === null) {
            reference.index[row] = 0;
            reference.generation[row] = 0;
        } else {
            const entity = value as Entity;
            reference.index[row] = entity.index + 1;
            reference.generation[row] = entity.generation;
        }
    } else (column as NumericColumn)[row] = kind === "bool" ? (value ? 1 : 0) : (value as number);
}
function copyColumnRow(column: Column, source: number, target: number): void {
    if ("index" in column) {
        column.index[target] = column.index[source];
        column.generation[target] = column.generation[source];
    } else column[target] = column[source];
}
function clearColumnRow(column: Column, row: number): void {
    if ("index" in column) {
        column.index[row] = 0;
        column.generation[row] = 0;
    } else column[row] = 0;
}
function clearColumn(column: Column): void {
    if ("index" in column) {
        column.index.fill(0);
        column.generation.fill(0);
    } else column.fill(0);
}

function createChunkDescriptor<Types extends readonly AnySchemaComponent[]>(
    world: World,
    epoch: number,
    archetype: SchemaArchetype,
    chunk: SchemaChunkRuntime,
    types: Types,
): SchemaChunk<Types> {
    const assertValid = (): void => {
        if (world.commitEpoch !== epoch) throw new Error("Schema chunk borrow has expired");
    };
    const componentViews = new Map<AnySchemaComponent, object>();
    for (const type of types) {
        const typeIndex = archetype.types.indexOf(type),
            view = {};
        for (const [fieldName, descriptor] of Object.entries(type.fields)) {
            const column = chunk.columns[typeIndex][fieldName];
            const exposed =
                descriptor.kind === "entity"
                    ? defineOpaque(
                          {},
                          {
                              index: (column as EntityReferenceColumn).index,
                              generation: (column as EntityReferenceColumn).generation,
                          },
                      )
                    : column;
            Object.defineProperty(view, fieldName, { value: exposed });
        }
        componentViews.set(type, Object.freeze(view));
    }
    const views = {};
    for (const type of types)
        Object.defineProperty(views, type.name, {
            get() {
                assertValid();
                return componentViews.get(type);
            },
        });
    Object.freeze(views);
    const descriptor = {};
    Object.defineProperties(descriptor, {
        count: {
            get() {
                assertValid();
                return chunk.count;
            },
        },
        capacity: {
            get() {
                assertValid();
                return CHUNK_CAPACITY;
            },
        },
        views: {
            get() {
                assertValid();
                return views;
            },
        },
        entityAt: {
            value(row: number) {
                assertValid();
                if (!Number.isInteger(row) || row < 0 || row >= chunk.count)
                    throw new Error("Schema chunk row is outside the live range");
                return chunk.entities[row]!;
            },
        },
    });
    return Object.freeze(descriptor) as SchemaChunk<Types>;
}
function defineOpaque<T extends object>(target: T, values: Record<string, unknown>): T {
    for (const [name, value] of Object.entries(values))
        Object.defineProperty(target, name, { value });
    return Object.freeze(target);
}
function inspectColumnValue(
    column: Column,
    descriptor: FieldDescriptor<unknown>,
    row: number,
): unknown {
    if (descriptor.kind === "entity") {
        const reference = column as EntityReferenceColumn;
        return reference.index[row] === 0
            ? null
            : { index: reference.index[row] - 1, generation: reference.generation[row] };
    }
    const value = (column as NumericColumn)[row];
    return descriptor.kind === "bool" ? value !== 0 : value;
}
function inspectFieldValue(value: unknown): unknown {
    return isEntity(value) ? { index: value.index, generation: value.generation } : value;
}
function enumerateEntities(archetypes: readonly Archetype[]): object[] {
    const entities: object[] = [];
    for (const archetype of archetypes) {
        if (archetype.mode === "legacy") {
            for (let row = 0; row < archetype.entities.length; row++) {
                const entity = archetype.entities[row];
                entities.push({
                    index: entity.index,
                    generation: entity.generation,
                    components: archetype.types.map((type, column) => ({
                        name: type.name,
                        value: archetype.columns[column][row],
                    })),
                });
            }
            continue;
        }
        for (const chunk of archetype.chunks) {
            for (let row = 0; row < chunk.count; row++) {
                const entity = chunk.entities[row]!;
                entities.push({
                    index: entity.index,
                    generation: entity.generation,
                    components: archetype.types.map((type, typeIndex) => ({
                        name: type.name,
                        fields: Object.entries(type.fields).map(([fieldName, descriptor]) => ({
                            name: fieldName,
                            kind: descriptor.kind,
                            value: inspectColumnValue(
                                chunk.columns[typeIndex][fieldName],
                                descriptor,
                                row,
                            ),
                        })),
                    })),
                });
            }
        }
    }
    return entities;
}
function getValueMode(values: readonly AnyComponentValue[]): "legacy" | "schema" {
    const schemaCount = values.filter((value) => isSchemaComponent(value.component)).length;
    if (schemaCount !== 0 && schemaCount !== values.length)
        throw new Error("Cannot mix schema and legacy components in a spawn");
    return schemaCount ? "schema" : "legacy";
}
function isSchemaComponent(value: unknown): value is AnySchemaComponent {
    return typeof value === "object" && value !== null && SCHEMA_COMPONENT in value;
}
function isFieldDescriptor(value: unknown): value is FieldDescriptor<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        typeof value.kind === "string" &&
        ["f32", "f64", "i32", "u32", "u8", "bool", "entity"].includes(value.kind)
    );
}
function isEntity(value: unknown): value is Entity {
    return (
        typeof value === "object" &&
        value !== null &&
        "index" in value &&
        typeof value.index === "number" &&
        Number.isInteger(value.index) &&
        value.index >= 0 &&
        "generation" in value &&
        typeof value.generation === "number" &&
        Number.isInteger(value.generation) &&
        value.generation >= 0 &&
        "owner" in value &&
        typeof value.owner === "symbol"
    );
}
function validateNumber(label: string, value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`Invalid finite number: ${label}`);
    return value;
}
function validateF32(label: string, value: unknown): number {
    const rounded = Math.fround(validateNumber(label, value));
    if (!Number.isFinite(rounded)) throw new Error(`Invalid finite float32: ${label}`);
    return rounded;
}
function validateInteger(label: string, value: unknown, min: number, max: number): number {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
        throw new Error(`Invalid integer: ${label}`);
    return value as number;
}

function validateDescriptorDefault(label: string, descriptor: FieldDescriptor<unknown>): unknown {
    switch (descriptor.kind) {
        case "f32":
            return validateF32(label, descriptor.default);
        case "f64":
            return validateNumber(label, descriptor.default);
        case "i32":
            return validateInteger(label, descriptor.default, -0x80000000, 0x7fffffff);
        case "u32":
            return validateInteger(label, descriptor.default, 0, 0xffffffff);
        case "u8":
            return validateInteger(label, descriptor.default, 0, 0xff);
        case "bool":
            if (typeof descriptor.default !== "boolean")
                throw new Error(`Invalid boolean: ${label}`);
            return descriptor.default;
        case "entity":
            if (descriptor.default !== null)
                throw new Error(`Entity reference defaults are always null: ${label}`);
            return null;
    }
}

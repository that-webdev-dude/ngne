/** Complete, fixed-composition entities; dense archetypes keep hot queries linear. */
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
export type ComponentValue<T extends object = any> = {
    component: Component<T>;
    value: T;
};
export const component = <T extends object>(name: string, create: () => T) =>
    new Component(name, create);
export type Entity = Readonly<{
    index: number;
    generation: number;
    owner: symbol;
}>;
type Slot = {
    generation: number;
    archetype?: Archetype;
    row: number;
    pending: boolean;
};
type Archetype = {
    types: Component<any>[];
    entities: Entity[];
    columns: any[][];
};
type Values<T extends readonly Component<any>[]> = {
    [K in keyof T]: T[K] extends Component<infer V> ? V : never;
};
export interface WorldAccess {
    spawn(...values: ComponentValue[]): Entity;
    despawn(entity: Entity): void;
    has(entity: Entity): boolean;
    get<T extends object>(entity: Entity, type: Component<T>): T | undefined;
    query<T extends readonly Component<any>[]>(...types: T): Query<T>;
}
export interface Query<T extends readonly Component<any>[]> {
    readonly size: number;
    each(visit: (entity: Entity, ...values: Values<T>) => void): void;
}
class QueryRuntime<T extends readonly Component<any>[]> implements Query<T> {
    private matches: { archetype: Archetype; columns: any[][] }[] = [];
    constructor(
        private world: World,
        private types: T,
    ) {}
    add(archetype: Archetype) {
        if (this.types.every((type) => archetype.types.includes(type)))
            this.matches.push({
                archetype,
                columns: this.types.map(
                    (t) => archetype.columns[archetype.types.indexOf(t)],
                ),
            });
    }
    get size() {
        return this.matches.reduce(
            (n, m) => n + m.archetype.entities.length,
            0,
        );
    }
    each(visit: (entity: Entity, ...values: Values<T>) => void): void {
        this.world.beginRead();
        try {
            // Reuse a single argument array per archetype, never allocate per entity.
            for (const { archetype, columns } of this.matches) {
                const args: any[] = new Array(columns.length + 1);
                for (let i = 0; i < archetype.entities.length; i++) {
                    args[0] = archetype.entities[i];
                    for (let c = 0; c < columns.length; c++)
                        args[c + 1] = columns[c][i];
                    (visit as Function)(...args);
                }
            }
        } finally {
            this.world.endRead();
        }
    }
}
export class World implements WorldAccess {
    private owner = Symbol("world");
    private slots: Slot[] = [];
    private free: number[] = [];
    private archetypes: Archetype[] = [];
    private queries: QueryRuntime<any>[] = [];
    private births: { entity: Entity; values: ComponentValue[] }[] = [];
    private deaths = new Set<Entity>();
    private reading = 0;
    private disposed = false;
    private definitions = new Map<string, Component<any>>();
    readonly access: WorldAccess = Object.freeze({
        spawn: (...v: ComponentValue[]) => this.spawn(...v),
        despawn: (e: Entity) => this.despawn(e),
        has: (e: Entity) => this.has(e),
        get: <T extends object>(e: Entity, t: Component<T>) => this.get(e, t),
        query: <T extends readonly Component<any>[]>(...t: T) =>
            this.query(...t),
    });
    get size() {
        return this.archetypes.reduce((n, a) => n + a.entities.length, 0);
    }
    get capacity() {
        return this.slots.length;
    }
    beginRead() {
        this.reading++;
    }
    endRead() {
        this.reading--;
    }
    spawn(...values: ComponentValue[]): Entity {
        if (this.disposed) throw new Error("World is disposed");
        if (new Set(values.map((v) => v.component)).size !== values.length)
            throw new Error("Duplicate component");
        for (const { component: type } of values) {
            const existing = this.definitions.get(type.name);
            if (existing && existing !== type)
                throw new Error("Conflicting component identity: " + type.name);
            this.definitions.set(type.name, type);
        }
        const index = this.free.pop() ?? this.slots.length;
        const slot = this.slots[index] ?? {
            generation: 0,
            row: -1,
            pending: true,
        };
        slot.pending = true;
        this.slots[index] = slot;
        const entity = Object.freeze({
            index,
            generation: slot.generation,
            owner: this.owner,
        });
        this.births.push({ entity, values });
        return entity;
    }
    private slot(e: Entity) {
        const s = this.slots[e.index];
        return e.owner === this.owner && s?.generation === e.generation
            ? s
            : undefined;
    }
    has(e: Entity) {
        return !!this.slot(e)?.archetype;
    }
    get<T extends object>(e: Entity, type: Component<T>): T | undefined {
        const s = this.slot(e);
        if (!s?.archetype) return;
        return s.archetype.columns[s.archetype.types.indexOf(type)]?.[s.row];
    }
    despawn(e: Entity) {
        const s = this.slot(e);
        if (s && (s.archetype || s.pending)) this.deaths.add(e);
    }
    query<T extends readonly Component<any>[]>(...types: T): Query<T> {
        if (this.disposed) throw new Error("World is disposed");
        const q = new QueryRuntime(this, types);
        this.queries.push(q);
        this.archetypes.forEach((a) => q.add(a));
        return q;
    }
    commit() {
        if (this.reading)
            throw new Error("Cannot commit during query iteration");
        for (const { entity, values } of this.births) {
            let a = this.archetypes.find(
                (a) =>
                    a.types.length === values.length &&
                    values.every((v) => a!.types.includes(v.component)),
            );
            if (!a) {
                a = {
                    types: values.map((v) => v.component),
                    columns: values.map(() => []),
                    entities: [],
                };
                this.archetypes.push(a);
                this.queries.forEach((q) => q.add(a!));
            }
            const s = this.slot(entity)!;
            s.archetype = a;
            s.pending = false;
            s.row = a.entities.length;
            a.entities.push(entity);
            a.types.forEach((t, i) =>
                a!.columns[i].push(
                    values.find((v) => v.component === t)!.value,
                ),
            );
        }
        this.births.length = 0;
        for (const entity of this.deaths) {
            const s = this.slot(entity);
            if (!s?.archetype) continue;
            const a = s.archetype,
                last = a.entities.length - 1;
            if (s.row !== last) {
                a.entities[s.row] = a.entities[last];
                this.slots[a.entities[s.row].index].row = s.row;
                for (const column of a.columns) column[s.row] = column[last];
            }
            a.entities.pop();
            a.columns.forEach((c) => c.pop());
            s.archetype = undefined;
            s.row = -1;
            s.generation++;
            this.free.push(entity.index);
        }
        this.deaths.clear();
    }
    enumerate() {
        return {
            // Empty archetypes retain creation order and can affect later query order.
            archetypes: this.archetypes.map((a) => ({
                components: a.types.map((type) => type.name),
                entities: a.entities.map((entity) => entity.index),
            })),
            slots: this.slots.map((s) => ({
                generation: s.generation,
                row: s.row,
                pending: s.pending,
            })),
            free: [...this.free],
            entities: this.archetypes.flatMap((a) =>
                a.entities.map((e, i) => ({
                    index: e.index,
                    generation: e.generation,
                    components: a.types.map((t, c) => ({
                        name: t.name,
                        value: a.columns[c][i],
                    })),
                })),
            ),
        };
    }
    dispose() {
        this.disposed = true;
        this.births.length = 0;
        this.deaths.clear();
        for (const a of this.archetypes) {
            a.entities.length = 0;
            a.columns.forEach((c) => (c.length = 0));
        }
        this.archetypes.length = 0;
        this.queries.length = 0;
        this.slots.length = 0;
        this.free.length = 0;
    }
}

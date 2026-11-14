from .components import COMPONENT_TYPES
from .solver import CircuitError, solve_linear

GMIN = 1e-12

class _Context:
    def __init__(self, size):
        self.A = [[0.0] * size for _ in range(size)]
        self.z = [0.0] * size
        self.dt = None
        self.t = 0.0

    def conductance(self, a, b, g):
        A = self.A
        if a >= 0:
            A[a][a] += g
        if b >= 0:
            A[b][b] += g
        if a >= 0 and b >= 0:
            A[a][b] -= g
            A[b][a] -= g

    def current(self, a, b, i):
        if a >= 0:
            self.z[a] -= i
        if b >= 0:
            self.z[b] += i

class Circuit:
    GROUND = "GND"

    def __init__(self):
        self.components = []
        self._parent = {}
        self._ground_key = ("net", self.GROUND)

    def add(self, component):
        if any(c.name == component.name for c in self.components):
            raise CircuitError(f"Duplicate component name {component.name!r}")
        self.components.append(component)
        for pin in component.pins.values():
            self._parent[pin] = pin
        return component

    def _find(self, x):
        self._parent.setdefault(x, x)
        root = x
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[x] != root:
            self._parent[x], x = root, self._parent[x]
        return root

    def _union(self, a, b):
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            self._parent[ra] = rb

    def connect(self, *pins):
        for other in pins[1:]:
            self._union(pins[0], other)

    def ground(self, *pins):
        for p in pins:
            self._union(p, self._ground_key)

    def connect_net(self, pin, net_label):
        self._union(pin, ("net", net_label))

    @classmethod
    def from_dict(cls, data):
        c = cls()
        for spec in data.get("components", []):
            ctype = spec["type"]
            if ctype not in COMPONENT_TYPES:
                raise CircuitError(f"Unknown component type {ctype!r}")
            name, val = spec["id"], spec.get("value")
            klass = COMPONENT_TYPES[ctype]
            if ctype in ("resistor", "capacitor", "inductor"):
                comp = klass(name, val)
            elif ctype == "battery":
                comp = klass(name, val, spec.get("internal", 0.1))
            elif ctype == "acsource":
                comp = klass(name, val, spec.get("hertz", 50))
            elif ctype == "switch":
                comp = klass(name, bool(spec.get("closed", True)))
            else:
                comp = klass(name)
            c.add(comp)
            for pin, net in zip(comp.pins.values(), spec["nodes"]):
                c.connect_net(pin, net)
        return c

    def _index_nodes(self):
        gnd_root = self._find(self._ground_key)
        roots, names = {}, []
        for comp in self.components:
            for pin in comp.pins.values():
                r = self._find(pin)
                if r == gnd_root:
                    comp.node_index[pin.name] = -1
                    continue
                if r not in roots:
                    roots[r] = len(names)
                    label = r[1] if isinstance(r, tuple) else f"N{len(names) + 1}"
                    names.append(label if label not in names else f"{label}_{len(names)}")
                comp.node_index[pin.name] = roots[r]
        if not any(-1 in c.node_index.values() for c in self.components):
            raise CircuitError("No ground. Add a ground symbol to your circuit.")
        return len(names), names

    @staticmethod
    def _v(x, comp, pin):
        k = comp.node_index[pin]
        return 0.0 if k < 0 else x[k]

    def _solve_step(self, size, t, dt):
        nonlinear = [c for c in self.components if c.nonlinear]
        x = [0.0] * size
        for it in range(200 if nonlinear else 1):
            ctx = _Context(size)
            ctx.t, ctx.dt = t, dt
            for i in range(size):
                ctx.A[i][i] += GMIN
            for comp in self.components:
                comp.stamp(ctx)
            new_x = solve_linear(ctx.A, ctx.z)
            if not nonlinear:
                return new_x
            delta = max(c.newton_update(self._v(new_x, c, "a"), self._v(new_x, c, "k"))
                        for c in nonlinear)
            change = max((abs(a - b) for a, b in zip(new_x, x)), default=0.0)
            x = new_x
            if it > 0 and delta < 1e-9 and change < 1e-7:
                return x
        raise CircuitError("The diode/LED equations did not converge.")

    def _commit(self, x, t, dt):
        for comp in self.components:
            pa, pb = list(comp.pins)
            comp._t = t
            comp.commit(self._v(x, comp, pa), self._v(x, comp, pb), dt)

    def reset(self):
        for c in self.components:
            c.reset()

    def solve_dc(self):
        size, names = self._index_nodes()
        self.reset()
        x = self._solve_step(size, 0.0, None)
        self._commit(x, 0.0, None)
        return dict(zip(names, x))

    def simulate(self, t_end=0.01, dt=None, max_points=800):
        size, names = self._index_nodes()
        dt = dt or t_end / 2000
        steps = max(1, int(round(t_end / dt)))
        if steps > 200_000:
            raise CircuitError("Too many steps. Increase dt or reduce the duration.")
        stride = max(1, steps // max_points)
        self.reset()
        out = {"t": [], "nodes": {n: [] for n in names},
               "components": {c.name: {"v": [], "i": []} for c in self.components}}
        for k in range(1, steps + 1):
            t = k * dt
            x = self._solve_step(size, t, dt)
            self._commit(x, t, dt)
            if k % stride == 0 or k == steps:
                out["t"].append(t)
                for n, v in zip(names, x):
                    out["nodes"][n].append(v)
                for c in self.components:
                    out["components"][c.name]["v"].append(c.v)
                    out["components"][c.name]["i"].append(c.i)
        out["nodes"][self.GROUND] = [0.0] * len(out["t"])
        out["final"] = {
            "nodes": {n: s[-1] for n, s in out["nodes"].items()},
            "components": {
                c.name: {"v": c.v, "i": c.i, "p": c.power,
                         **({"brightness": c.brightness} if hasattr(c, "brightness") else {})}
                for c in self.components},
        }
        return out

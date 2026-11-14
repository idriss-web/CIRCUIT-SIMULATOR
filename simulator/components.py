import math

VT = 0.025852

class Pin:
    def __init__(self, component, name):
        self.component = component
        self.name = name

    def __repr__(self):
        return f"{self.component.name}.{self.name}"

class Component:
    kind = "component"
    pin_names = ("a", "b")
    nonlinear = False

    def __init__(self, name):
        self.name = name
        self.pins = {p: Pin(self, p) for p in self.pin_names}
        self.v = 0.0
        self.i = 0.0
        self.node_index = {}
        self._t = 0.0

    def __getattr__(self, item):
        pins = self.__dict__.get("pins", {})
        if item in pins:
            return pins[item]
        raise AttributeError(item)

    @property
    def power(self):
        return self.v * self.i

    def reset(self):
        self.v = self.i = 0.0

    def stamp(self, ctx):
        pass

    def commit(self, va, vb, dt):
        self.v = va - vb

class Resistor(Component):
    kind = "resistor"

    def __init__(self, name, ohms=1000.0):
        super().__init__(name)
        self.ohms = float(ohms)

    def stamp(self, ctx):
        ctx.conductance(self.node_index["a"], self.node_index["b"], 1.0 / self.ohms)

    def commit(self, va, vb, dt):
        self.v = va - vb
        self.i = self.v / self.ohms

class Battery(Component):
    kind = "battery"
    pin_names = ("pos", "neg")

    def __init__(self, name, volts=9.0, internal_ohms=0.1):
        super().__init__(name)
        self.volts = float(volts)
        self.r = float(internal_ohms)

    def emf(self, t):
        return self.volts

    def stamp(self, ctx):
        p, n = self.node_index["pos"], self.node_index["neg"]
        ctx.conductance(p, n, 1.0 / self.r)
        ctx.current(n, p, self.emf(ctx.t) / self.r)

    def commit(self, va, vb, dt):
        self.v = va - vb
        self.i = -(self.emf(self._t) - self.v) / self.r

class ACSource(Battery):
    kind = "acsource"

    def __init__(self, name, amplitude=5.0, hertz=50.0, internal_ohms=0.01):
        super().__init__(name, amplitude, internal_ohms)
        self.hertz = float(hertz)

    def emf(self, t):
        return self.volts * math.sin(2 * math.pi * self.hertz * t)

class Capacitor(Component):
    kind = "capacitor"

    def __init__(self, name, farads=100e-6, initial_volts=0.0):
        super().__init__(name)
        self.farads = float(farads)
        self.initial = float(initial_volts)
        self.v_prev = self.initial

    def reset(self):
        super().reset()
        self.v_prev = self.initial

    def stamp(self, ctx):
        if ctx.dt is None:
            return
        g = self.farads / ctx.dt
        a, b = self.node_index["a"], self.node_index["b"]
        ctx.conductance(a, b, g)
        ctx.current(a, b, -g * self.v_prev)

    def commit(self, va, vb, dt):
        self.v = va - vb
        self.i = 0.0 if dt is None else self.farads * (self.v - self.v_prev) / dt
        self.v_prev = self.v

class Inductor(Component):
    kind = "inductor"

    def __init__(self, name, henries=0.1):
        super().__init__(name)
        self.henries = float(henries)
        self.i_prev = 0.0

    def reset(self):
        super().reset()
        self.i_prev = 0.0

    def stamp(self, ctx):
        a, b = self.node_index["a"], self.node_index["b"]
        if ctx.dt is None:
            ctx.conductance(a, b, 1e6)
            return
        g = ctx.dt / self.henries
        ctx.conductance(a, b, g)
        ctx.current(a, b, self.i_prev)

    def commit(self, va, vb, dt):
        self.v = va - vb
        if dt is None:
            self.i = self.v * 1e6
        else:
            self.i = self.i_prev + dt / self.henries * self.v
        self.i_prev = self.i

class Switch(Component):
    kind = "switch"

    def __init__(self, name, closed=True):
        super().__init__(name)
        self.closed = bool(closed)

    @property
    def ohms(self):
        return 1e-3 if self.closed else 1e9

    def stamp(self, ctx):
        ctx.conductance(self.node_index["a"], self.node_index["b"], 1.0 / self.ohms)

    def commit(self, va, vb, dt):
        self.v = va - vb
        self.i = self.v / self.ohms

class Diode(Component):
    kind = "diode"
    pin_names = ("a", "k")
    nonlinear = True
    sat_current = 1e-14
    ideality = 1.0

    def __init__(self, name):
        super().__init__(name)
        self.v_op = 0.0
        self.vt = self.ideality * VT
        self.vcrit = self.vt * math.log(self.vt / (math.sqrt(2) * self.sat_current))

    def reset(self):
        super().reset()
        self.v_op = 0.0

    def _iv(self, v):
        e = math.exp(min(v / self.vt, 80.0))
        return self.sat_current * (e - 1.0), self.sat_current * e / self.vt

    def stamp(self, ctx):
        i0, g = self._iv(self.v_op)
        g += 1e-12
        a, k = self.node_index["a"], self.node_index["k"]
        ctx.conductance(a, k, g)
        ctx.current(a, k, i0 - g * self.v_op)

    def newton_update(self, va, vb):
        vnew, vold = va - vb, self.v_op
        if vnew > self.vcrit and abs(vnew - vold) > 2 * self.vt:
            if vold > 0:
                arg = 1 + (vnew - vold) / self.vt
                vnew = vold + self.vt * math.log(arg) if arg > 0 else self.vcrit
            else:
                vnew = self.vt * math.log(vnew / self.vt)
        self.v_op = vnew
        return abs(vnew - vold)

    def commit(self, va, vb, dt):
        self.v = va - vb
        self.i = self._iv(self.v)[0]

class LED(Diode):
    kind = "led"
    sat_current = 1e-18
    ideality = 2.0

    @property
    def brightness(self):
        return max(0.0, min(1.0, self.i / 0.020))

COMPONENT_TYPES = {
    "resistor": Resistor,
    "battery": Battery,
    "acsource": ACSource,
    "capacitor": Capacitor,
    "inductor": Inductor,
    "switch": Switch,
    "diode": Diode,
    "led": LED,
}

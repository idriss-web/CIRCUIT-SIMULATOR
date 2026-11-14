import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from simulator import Circuit, Battery, Resistor, Capacitor, LED

c = Circuit()
bat = c.add(Battery("B1", 5))
r = c.add(Resistor("R1", 1000))
cap = c.add(Capacitor("C1", 100e-6))
c.connect(bat.pos, r.a)
c.connect(r.b, cap.a)
c.ground(cap.b, bat.neg)
res = c.simulate(t_end=0.5, dt=0.5 / 5000)
print(f"RC: capacitor reached {cap.v:.3f} V after 0.5 s (theory {5 * (1 - 2.71828 ** -5):.3f} V)")

c = Circuit()
bat = c.add(Battery("B1", 9))
r = c.add(Resistor("R1", 470))
led = c.add(LED("D1"))
c.connect(bat.pos, r.a)
c.connect(r.b, led.a)
c.ground(led.k, bat.neg)
c.solve_dc()
print(f"LED: {led.v:.2f} V across it, {led.i * 1000:.1f} mA flowing, brightness {led.brightness:.0%}")

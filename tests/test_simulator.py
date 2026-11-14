import math, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from simulator import *

class Tests(unittest.TestCase):
    def test_voltage_divider(self):
        c = Circuit()
        b = c.add(Battery("B1", 10, 1e-6)); r1 = c.add(Resistor("R1", 1000)); r2 = c.add(Resistor("R2", 3000))
        c.connect(b.pos, r1.a); c.connect(r1.b, r2.a); c.ground(r2.b, b.neg)
        v = c.solve_dc()
        mid = v[next(k for k in v if k not in ("GND",) and abs(v[k] - 7.5) < 1e-3)]
        self.assertAlmostEqual(mid, 7.5, places=3)
        self.assertAlmostEqual(r1.i, 10 / 4000, places=6)

    def test_rc_charging(self):
        c = Circuit()
        b = c.add(Battery("B1", 5, 1e-6)); r = c.add(Resistor("R1", 1000)); cap = c.add(Capacitor("C1", 1e-6))
        c.connect(b.pos, r.a); c.connect(r.b, cap.a); c.ground(cap.b, b.neg)
        out = c.simulate(t_end=1e-3, dt=1e-6)
        self.assertAlmostEqual(cap.v, 5 * (1 - math.exp(-1)), delta=0.02)

    def test_led_forward_voltage(self):
        c = Circuit()
        b = c.add(Battery("B1", 5, 1e-3)); r = c.add(Resistor("R1", 330)); led = c.add(LED("D1"))
        c.connect(b.pos, r.a); c.connect(r.b, led.a); c.ground(led.k, b.neg)
        c.solve_dc()
        self.assertTrue(1.5 < led.v < 2.3, led.v)
        self.assertAlmostEqual(led.i, (5 - led.v) / 330, delta=2e-4)

    def test_open_switch_blocks_current(self):
        c = Circuit()
        b = c.add(Battery("B1", 5)); s = c.add(Switch("S1", False)); r = c.add(Resistor("R1", 100))
        c.connect(b.pos, s.a); c.connect(s.b, r.a); c.ground(r.b, b.neg)
        c.solve_dc()
        self.assertLess(abs(r.i), 1e-6)

    def test_missing_ground(self):
        c = Circuit()
        b = c.add(Battery("B1", 5)); r = c.add(Resistor("R1", 100))
        c.connect(b.pos, r.a); c.connect(b.neg, r.b)
        with self.assertRaises(CircuitError):
            c.solve_dc()

if __name__ == "__main__":
    unittest.main()

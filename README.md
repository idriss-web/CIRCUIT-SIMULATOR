

Uploading CIRCUIT.mp4…



# Circuit Bench: a Python electronic circuit simulator

Pure Python 3.8+, **no dependencies**. Build a circuit in the browser (served from
localhost) or in code, and the Python engine solves it.

## Run it

    python server.py            # opens http://127.0.0.1:8000
    python server.py --port 9000 --no-browser

Run the tests:  `python tests/test_simulator.py`
Run the code-only demo:  `python examples/rc_and_led.py`

## Using the web editor
1. Pick a part on the left, click the board to place it (Shift+click places several).
2. Click one pin, then another pin, to draw a wire.
3. Add a **Ground**. Every circuit needs one.
4. Click a part to edit its value (`4.7k`, `100u`, `10m`, `1meg` all work). Press **R** to rotate, **Delete** to remove.
5. Click a switch to open or close it. The result and plots update on every change.

The Voltage / Current tabs below the board show signals over time; hover for exact values.

## How it works
| File | Role |
|---|---|
| `simulator/components.py` | `Battery`, `ACSource`, `Resistor`, `Capacitor`, `Inductor`, `Diode`, `LED`, `Switch`, each a class with pins |
| `simulator/circuit.py` | `Circuit`: wires pins into nodes, builds the equations, steps time |
| `simulator/solver.py` | Gaussian elimination |
| `server.py` | `http.server` serving `web/` plus `POST /api/simulate` |

Method: Modified Nodal Analysis. Capacitors and inductors use backward-Euler
companion models; diodes and LEDs use Newton-Raphson with SPICE-style voltage limiting.

## Use it as a library
    from simulator import Circuit, Battery, Resistor, Capacitor
    c = Circuit()
    bat, r, cap = c.add(Battery("B1", 5)), c.add(Resistor("R1", 1000)), c.add(Capacitor("C1", 100e-6))
    c.connect(bat.pos, r.a); c.connect(r.b, cap.a); c.ground(cap.b, bat.neg)
    c.simulate(t_end=0.5)
    print(cap.v)

Sign convention: passive. A supplying battery shows negative current and power.

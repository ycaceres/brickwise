/**
 * <bw-chart compact help heading="Session chart">: the session chart
 * (ui/chart.js) in a component. With "heading" or "help" it gets a title row,
 * and "help" adds the "?" popover that explains the colors (help="ride" for
 * the bike workout chart). .heading sets the
 * title; .update(...) passes the data on to SessionChart.
 */
import { SessionChart } from '../ui/chart.js';

const HELP = {
  run: `
      <h2>How to read the chart</h2>
      <ul>
        <li><i class="line" style="background: var(--series-speed)"></i><span>Actual <b>pace</b>, on the left scale (min/km).</span></li>
        <li><i class="line" style="background: var(--series-hr)"></i><span>Actual <b>HR</b>, on the right scale (bpm).</span></li>
        <li><i class="line" style="background: var(--series-incline)"></i><span>Actual <b>incline</b>, in the lower part (no scale; the value is in the tooltip).</span></li>
        <li><i class="dash"></i><span><b>Dashed lines:</b> the plan. Red is the step's HR cap or goal; green is the planned incline.</span></li>
        <li><i class="block"></i><span><b>Background blocks:</b> the whole workout. Width = duration, height = speed, color = zone. What is done gets dimmed and the white bar marks where you are.</span></li>
        <li><i class="block alpha-key"></i><span><b>Bottom ribbon (α1):</b> with a chest strap, heart rate variability (DFA α1 over the last 2 min). Green: aerobic (&gt; 0.75); orange: transition (0.5–0.75); red: above the anaerobic threshold (&lt; 0.5); gray: computing or noisy signal.</span></li>
        <li><i class="block cols"></i><span><b>Side columns:</b> pace zones (left) and HR zones (right), aligned at the same height. On top, the zone you are in right now.</span></li>
      </ul>
      <div class="zones"><span><i style="background: var(--zone-1)"></i>Z1 gray</span><span><i style="background: var(--zone-2)"></i>Z2 blue</span><span><i style="background: var(--zone-3)"></i>Z3 green</span><span><i style="background: var(--zone-4)"></i>Z4 yellow</span><span><i style="background: var(--zone-5)"></i>Z5 orange</span><span><i style="background: var(--zone-6)"></i>Z6 red</span><span><i style="background: var(--zone-7)"></i>Z7 violet</span></div>
      <p class="note">Hover (or drag a finger) over the chart to see the values at each moment.</p>`,
  ride: `
      <h2>How to read the chart</h2>
      <ul>
        <li><i class="block"></i><span><b>Blocks:</b> the whole workout. Width = duration, height = target power on the left scale (W), color = power zone. Ramps slope; a step with a power range sits in the middle of it.</span></li>
        <li><i class="dash"></i><span><b>Dashed red line:</b> the step's HR goal, on the right scale (bpm).</span></li>
        <li><i class="block cols"></i><span><b>Side columns:</b> power zones (left) and HR zones (right), aligned at the same height.</span></li>
      </ul>
      <div class="zones"><span><i style="background: var(--zone-1)"></i>Z1 gray</span><span><i style="background: var(--zone-2)"></i>Z2 blue</span><span><i style="background: var(--zone-3)"></i>Z3 green</span><span><i style="background: var(--zone-4)"></i>Z4 yellow</span><span><i style="background: var(--zone-5)"></i>Z5 orange</span><span><i style="background: var(--zone-6)"></i>Z6 red</span><span><i style="background: var(--zone-7)"></i>Z7 violet</span></div>
      <p class="note">Hover (or drag a finger) over the chart to see each step's watts and HR goal.</p>`,
};

let count = 0;

class BwChart extends HTMLElement {
  #chart = null;

  connectedCallback() {
    if (this.#chart) return;
    const help = this.hasAttribute('help');
    if (help || this.hasAttribute('heading')) {
      const id = `bw-chart-help-${++count}`;
      const head = document.createElement('div');
      head.className = 'viz-head';
      head.innerHTML = `<h2 data-part="heading"></h2>` + (help
        ? `<button class="help" popovertarget="${id}" aria-label="What each color means" title="What each color means">?</button>`
        : '');
      this.appendChild(head);
      this.heading = this.getAttribute('heading') ?? '';
      if (help) {
        const pop = document.createElement('div');
        pop.id = id;
        pop.popover = 'auto';
        pop.className = 'help-pop';
        pop.innerHTML = HELP[this.getAttribute('help')] ?? HELP.run;
        this.appendChild(pop);
      }
    }
    const root = document.createElement('div');
    this.appendChild(root);
    this.#chart = new SessionChart(root, { compact: this.hasAttribute('compact') });
  }

  set heading(text) {
    const h = this.querySelector('[data-part="heading"]');
    if (h) h.textContent = text;
  }

  update(data) {
    this.#chart?.update(data);
  }
}

customElements.define('bw-chart', BwChart);

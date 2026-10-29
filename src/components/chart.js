/**
 * <bw-chart compact help heading="Session chart">: the session chart
 * (ui/chart.js) in a component. With "heading" or "help" it gets a title row,
 * and "help" adds the "?" popover that explains the colors (help="ride" for
 * the bike workout chart). .heading sets the
 * title; .update(...) passes the data on to SessionChart.
 */
import { SessionChart } from '../ui/session-chart.js';
import { t } from '../i18n/index.js';

// The help texts are translation messages with markup (en.js chart.help.*)
const HELP = { run: 'chart.help.run_html', ride: 'chart.help.ride_html' };

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
        ? `<button class="help" popovertarget="${id}" data-i18n-label="chart.whatColorsMean" aria-label="${t('chart.whatColorsMean')}" title="${t('chart.whatColorsMean')}">?</button>`
        : '');
      this.appendChild(head);
      this.heading = this.getAttribute('heading') ?? '';
      if (help) {
        const pop = document.createElement('div');
        pop.id = id;
        pop.popover = 'auto';
        pop.className = 'help-pop';
        const key = HELP[this.getAttribute('help')] ?? HELP.run;
        pop.innerHTML = t(key);
        document.addEventListener('bw-language', () => { pop.innerHTML = t(key); });
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

/**
 * <bw-zone-table sport="run|ride" heading="Running zones">: HR zones next to
 * pace (run) or power (ride), a summary line and an optional note. Set
 * .data = { zones, note }; it hides itself while there are no zones.
 */
import { zoneTable } from '../ui/format.js';

class BwZoneTable extends HTMLElement {
  #data = {};

  connectedCallback() {
    if (this.firstElementChild) return;
    this.innerHTML = `
      <h2 data-part="heading"></h2>
      <table class="ztable num">
        <thead><tr data-part="head"></tr></thead>
        <tbody data-part="rows"></tbody>
      </table>
      <div class="zsummary num" data-part="summary"></div>
      <div class="note mt-4" data-part="note"></div>`;
    this.#part('heading').textContent = this.getAttribute('heading') ?? '';
    this.#render();
  }

  set data(d) {
    this.#data = d ?? {};
    this.#render();
  }

  #part(name) {
    return this.querySelector(`[data-part="${name}"]`);
  }

  #render() {
    if (!this.firstElementChild) return;
    const { head, rows, summary } = zoneTable(this.getAttribute('sport'), this.#data.zones);
    this.classList.toggle('hidden', !rows.length);
    this.#part('head').replaceChildren(...head.map((text) => Object.assign(document.createElement('th'), { textContent: text })));
    this.#part('rows').replaceChildren(...rows.map(({ zone, name, cells }) => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      const sw = document.createElement('i');
      sw.style.background = `var(--zone-${Math.min(7, zone)})`;
      td.append(sw, `Z${zone}`);
      td.title = name;
      tr.append(td, ...cells.map((text) => Object.assign(document.createElement('td'), { textContent: text })));
      return tr;
    }));
    this.#part('summary').textContent = summary;
    this.#part('note').textContent = this.#data.note ?? '';
  }
}

customElements.define('bw-zone-table', BwZoneTable);

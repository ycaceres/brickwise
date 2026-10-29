/**
 * <bw-user-card>: the Intervals.icu account (name, photo, place) with its
 * wellness stats and a status note. Set .data = { athlete, wellness } and
 * .note = text; the buttons fire bw-refresh and bw-signout (they bubble).
 */
import { initials, athleteMeta, wellnessStats } from '../ui/format.js';
import { t, translate } from '../i18n/index.js';

const TEMPLATE = `
  <div class="user-head">
    <span class="avatar" aria-hidden="true"><span data-part="initials"></span><img data-part="avatar" alt="" class="hidden"></span>
    <div class="user-id">
      <div class="user-name" data-part="name">Intervals.icu</div>
      <div class="note" data-part="meta"></div>
    </div>
    <div class="row">
      <button class="icon" data-action="bw-refresh" data-i18n-label="profile.refresh" aria-label="Refresh from Intervals.icu" title="Refresh from Intervals.icu"><bw-icon name="refresh"></bw-icon></button>
      <button class="icon danger" data-action="bw-signout" data-i18n-label="profile.signOut" aria-label="Sign out" title="Sign out"><bw-icon name="signout"></bw-icon></button>
    </div>
  </div>
  <div class="stats num" data-part="stats"></div>
  <div class="note" data-part="note"></div>`;

class BwUserCard extends HTMLElement {
  #data = {};
  #note = '';

  connectedCallback() {
    if (this.firstElementChild) return;
    this.innerHTML = TEMPLATE;
    translate(this);
    document.addEventListener('bw-language', () => { translate(this); this.#render(); });
    for (const btn of this.querySelectorAll('[data-action]')) {
      btn.onclick = () => this.dispatchEvent(new CustomEvent(btn.dataset.action, { bubbles: true }));
    }
    this.#render();
  }

  set data(d) {
    this.#data = d ?? {};
    this.#render();
  }

  set note(text) {
    this.#note = text ?? '';
    this.#render();
  }

  #part(name) {
    return this.querySelector(`[data-part="${name}"]`);
  }

  #render() {
    if (!this.firstElementChild) return;
    const { athlete, wellness } = this.#data;
    const name = athlete?.name || 'Intervals.icu';
    this.#part('name').textContent = name;
    this.#part('initials').textContent = initials(name);
    const img = this.#part('avatar');
    img.classList.toggle('hidden', !athlete?.photo);
    if (athlete?.photo && img.src !== athlete.photo) {
      img.onerror = () => img.classList.add('hidden');
      img.src = athlete.photo;
    }
    this.#part('meta').textContent = athleteMeta(athlete);
    this.#part('note').textContent = this.#note;
    this.#part('stats').replaceChildren(...wellnessStats(wellness, athlete).map(({ label, value, unit, date }) => {
      const div = document.createElement('div');
      if (date) div.title = t('stats.wellnessDate', { date });
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = value ?? '—';
      if (value != null) {
        const u = document.createElement('small');
        u.textContent = ` ${unit}`;
        v.appendChild(u);
      }
      div.append(l, v);
      return div;
    }));
  }
}

customElements.define('bw-user-card', BwUserCard);

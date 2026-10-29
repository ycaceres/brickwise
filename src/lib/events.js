/** A tiny event emitter: on(name, fn) and emit(name, value), called in order. */
export function createEmitter() {
  const listeners = {};
  return {
    on(name, fn) { (listeners[name] ||= []).push(fn); },
    emit(name, value) { for (const fn of listeners[name] || []) fn(value); },
  };
}

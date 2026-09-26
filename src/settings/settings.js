// Settings window page. Builds its controls from the schema sent by the main
// process, and saves each change right away through window.petSettings
// (defined in settings-preload.cjs). No framework: plain DOM.

const api = window.petSettings;
const container = document.getElementById('settings');
const status = document.getElementById('status');
const resetButton = document.getElementById('reset');

let schema = [];
let values = {};
const controls = new Map(); // key -> { sync(value) }

function showStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('is-error', isError);
}

async function change(key, value) {
  const result = await api.set(key, value);
  if (result?.ok) {
    values = result.values;
    showStatus('Saved');
  } else {
    showStatus(result?.error ?? 'Could not save that setting', true);
  }
  controls.get(key)?.sync(values[key]); // show what was actually stored
}

// --- Controls ---------------------------------------------------------------------

function switchControl(definition, id) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.className = 'switch';
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => change(definition.key, input.checked));
  return { element: input, sync: (value) => { input.checked = value === true; } };
}

function segmentedControl(definition, id) {
  const group = document.createElement('fieldset');
  group.className = 'segmented';
  group.setAttribute('aria-labelledby', `${id}-label`);
  const inputs = definition.options.map(([value, text], index) => {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = definition.key;
    input.id = `${id}-${index}`;
    input.value = value;
    input.addEventListener('change', () => { if (input.checked) change(definition.key, value); });
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = text;
    group.append(input, label);
    return input;
  });
  return { element: group, sync: (value) => { for (const input of inputs) input.checked = input.value === value; } };
}

function selectControl(definition, id) {
  const select = document.createElement('select');
  select.id = id;
  select.className = 'select';
  for (const [value, text] of definition.options) select.append(new Option(text, value));
  select.addEventListener('change', () => change(definition.key, select.value));
  return { element: select, sync: (value) => { select.value = value; } };
}

function sliderControl(definition, id) {
  const wrapper = document.createElement('div');
  wrapper.className = 'row__control';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = id;
  slider.className = 'slider';
  Object.assign(slider, { min: definition.min, max: definition.max, step: definition.step });
  const output = document.createElement('output');
  output.className = 'slider__value';
  output.htmlFor = id;
  const format = (value) => `${Number(value)}${definition.unit === '×' ? '×' : ` ${definition.unit ?? ''}`}`.trim();
  // Show the value while dragging; save when let go.
  slider.addEventListener('input', () => { output.textContent = format(slider.value); });
  slider.addEventListener('change', () => change(definition.key, Number(slider.value)));
  wrapper.append(slider, output);
  return {
    element: wrapper,
    sync: (value) => { slider.value = value; output.textContent = format(value); },
  };
}

function controlFor(definition, id) {
  if (definition.type === 'boolean') return switchControl(definition, id);
  if (definition.type === 'number') return sliderControl(definition, id);
  return definition.options.length <= 3 ? segmentedControl(definition, id) : selectControl(definition, id);
}

// --- Layout ------------------------------------------------------------------------

function render() {
  container.replaceChildren();
  const sections = [...new Set(schema.map((definition) => definition.section))];
  for (const sectionName of sections) {
    const section = document.createElement('section');
    section.className = 'section';
    const heading = document.createElement('h2');
    heading.className = 'section__title';
    heading.textContent = sectionName;
    const card = document.createElement('div');
    card.className = 'card';

    for (const definition of schema.filter((item) => item.section === sectionName)) {
      const id = `setting-${definition.key}`;
      const row = document.createElement('div');
      row.className = 'row';

      const text = document.createElement('div');
      text.className = 'row__text';
      const label = document.createElement(definition.type === 'choice' && definition.options.length <= 3 ? 'span' : 'label');
      label.className = 'row__label';
      label.id = `${id}-label`;
      label.textContent = definition.label;
      if (label.tagName === 'LABEL') label.htmlFor = id;
      text.append(label);
      if (definition.hint) {
        const hint = document.createElement('span');
        hint.className = 'row__hint';
        hint.id = `${id}-hint`;
        hint.textContent = definition.hint;
        text.append(hint);
      }

      const control = controlFor(definition, id);
      if (definition.hint) control.element.setAttribute('aria-describedby', `${id}-hint`);
      control.sync(values[definition.key]);
      controls.set(definition.key, control);

      const holder = document.createElement('div');
      holder.className = 'row__control';
      holder.append(control.element);
      row.append(text, holder);
      card.append(row);
    }
    section.append(heading, card);
    container.append(section);
  }
  container.setAttribute('aria-busy', 'false');
}

function syncAll() {
  for (const [key, control] of controls) control.sync(values[key]);
}

// --- Start ---------------------------------------------------------------------------

async function start() {
  if (!api) {
    showStatus('Settings are unavailable (preload missing).', true);
    return;
  }
  const loaded = await api.load();
  if (!loaded) {
    showStatus('Could not load settings.', true);
    return;
  }
  ({ schema, values } = loaded);
  const characterName = schema.find((item) => item.key === 'character')?.options
    ?.find(([id]) => id === values.character)?.[1];
  if (characterName) {
    document.title = `${characterName} settings`;
    document.querySelector('.top__title').textContent = `${characterName} settings`;
  }
  render();

  // Changes made elsewhere (e.g. the pet menu toggles) show up here too.
  api.onChange((next) => {
    values = next;
    syncAll();
  });

  resetButton.addEventListener('click', async () => {
    if (!window.confirm('Reset all settings to their defaults?')) return;
    const result = await api.reset();
    if (result?.ok) {
      values = result.values;
      syncAll();
      showStatus('All settings are back to their defaults');
    }
  });
}

start();

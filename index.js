let currentFromQuantity = 0;
let currentToQuantity = Infinity;
let showGibdd = true;

let selectedCategories = new Set();
let allCategories = [];

ymaps.ready(init);

function init() {
  fetch('anna.json')
    .then(response => response.json())
    .then(obj => {
      console.log('raw data:', obj);

      const searchControls = new ymaps.control.SearchControl({
        options: {
          float: 'right',
          noPlacemark: true
        }
      });

      const myMap = new ymaps.Map('map', {
        center: [55.76, 37.64],
        zoom: 7,
        controls: [searchControls]
      });

      const removeControls = [
        'geolocationControl',
        'trafficControl',
        'fullscreenControl',
        'zoomControl',
        'rulerControl',
        'typeSelector'
      ];
      removeControls.forEach(ctrl => myMap.controls.remove(ctrl));

      const objectManager = new ymaps.ObjectManager({
        clusterize: true,
        clusterIconLayout: 'default#pieChart'
      });

      let minLatitude = Infinity, maxLatitude = -Infinity;
      let minLongitude = Infinity, maxLongitude = -Infinity;

      let minQuantity = Infinity;
      let maxQuantity = -Infinity;

      const validFeatures = [];
      const categorySet = new Set();

      obj.features.forEach(feature => {
        if (!feature.geometry || !Array.isArray(feature.geometry.coordinates)) return;

        const [longitude, latitude] = feature.geometry.coordinates;
        const lat = Number(latitude);
        const lon = Number(longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        feature.geometry.coordinates = [lat, lon];

        minLatitude = Math.min(minLatitude, lat);
        maxLatitude = Math.max(maxLatitude, lat);
        minLongitude = Math.min(minLongitude, lon);
        maxLongitude = Math.max(maxLongitude, lon);

        if (!feature.properties) feature.properties = {};

        const q = extractQuantity(feature);
        const categories = extractCategories(feature);

        feature.properties.quantity = q;
        feature.properties.categoryList = categories;
        feature.properties.categoryNormalized = categories.join(', ');

        categories.forEach(cat => categorySet.add(cat));

        const preset = feature.options && feature.options.preset;
        const isBlue = preset === 'islands#blueIcon';

        if (!isBlue) {
          if (q === null) return;

          if (q < minQuantity) minQuantity = q;
          if (q > maxQuantity) maxQuantity = q;
        }

        validFeatures.push(feature);
      });

      if (validFeatures.length === 0) {
        console.warn('Нет точек для отображения.');
        return;
      }

      if (minQuantity === Infinity || maxQuantity === -Infinity) {
        minQuantity = 0;
        maxQuantity = 0;
      }

      allCategories = sortCategories(Array.from(categorySet));

      obj.features = validFeatures;

      objectManager.removeAll();
      objectManager.add(obj);
      myMap.geoObjects.add(objectManager);

      if (
        minLatitude !== Infinity && maxLatitude !== -Infinity &&
        minLongitude !== Infinity && maxLongitude !== -Infinity
      ) {
        const bounds = [
          [minLatitude, minLongitude],
          [maxLatitude, maxLongitude]
        ];
        myMap.setBounds(bounds, { checkZoomRange: true });
      }

      setupFilterUI(minQuantity, maxQuantity, objectManager, allCategories);
    })
    .catch(err => {
      console.error('Ошибка загрузки anna.json:', err);
    });
}

function extractQuantity(feature) {
  if (!feature.properties) return null;

  if (
    feature.properties.quantity !== undefined &&
    feature.properties.quantity !== null &&
    feature.properties.quantity !== ''
  ) {
    const qNum = Number(feature.properties.quantity);
    if (Number.isFinite(qNum)) return qNum;
  }

  const body = feature.properties.balloonContentBody;
  if (typeof body === 'string') {
    const re = /Кол-во\s+ДК\s+за\s+месяц:\s*<span[^>]*>([\d\s]+)/i;
    const match = body.match(re);
    if (match && match[1]) {
      const numStr = match[1].replace(/\s+/g, '');
      const q = parseInt(numStr, 10);
      if (!isNaN(q)) return q;
    }
  }

  return null;
}

function extractCategories(feature) {
  if (!feature.properties) return [];

  if (Array.isArray(feature.properties.categoryList)) {
    return feature.properties.categoryList
      .map(v => String(v).trim())
      .filter(Boolean)
      .filter((item, index, arr) => arr.indexOf(item) === index);
  }

  let raw = '';

  if (
    feature.properties.category !== undefined &&
    feature.properties.category !== null &&
    String(feature.properties.category).trim() !== ''
  ) {
    raw = String(feature.properties.category).trim();
  } else {
    const body = feature.properties.balloonContentBody;
    if (typeof body === 'string') {
      const re = /Категория:<\/span>\s*([^<]+)/i;
      const match = body.match(re);
      if (match && match[1]) {
        raw = match[1].trim();
      }
    }
  }

  if (!raw) return [];

  return raw
    .split(/[;,|]/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function sortCategories(categories) {
  const desiredOrder = [
    'A(L)',
    'B(M1)',
    'B(N1)',
    'C(N2)',
    'C(N3)',
    'E(O1)',
    'E(O2)',
    'E(O3)',
    'E(O4)',
    'Tm',
    'Tb'
  ];

  return categories.sort((a, b) => {
    const ia = desiredOrder.indexOf(a);
    const ib = desiredOrder.indexOf(b);

    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;

    return a.localeCompare(b, 'ru');
  });
}

function setupFilterUI(minQuantity, maxQuantity, objectManager, categories) {
  const toggleBtn = document.getElementById('filter-toggle');
  const categoryToggleBtn = document.getElementById('category-toggle');
  const gibddToggle = document.getElementById('gibdd-toggle');

  const panel = document.getElementById('filter-panel');
  const categoryPanel = document.getElementById('category-panel');

  const fromRange = document.getElementById('quantity-from-range');
  const toRange = document.getElementById('quantity-to-range');
  const fromInput = document.getElementById('quantity-from-input');
  const toInput = document.getElementById('quantity-to-input');

  const currentValueLabel = document.getElementById('filter-current-value');
  const warning = document.getElementById('filter-warning');

  const categoryList = document.getElementById('category-checkboxes');
  const btnSelectAll = document.getElementById('categories-select-all');
  const btnClearAll = document.getElementById('categories-clear-all');

  if (!toggleBtn || !categoryToggleBtn || !gibddToggle || !panel || !categoryPanel ||
      !fromRange || !toRange || !fromInput || !toInput ||
      !currentValueLabel || !warning ||
      !categoryList || !btnSelectAll || !btnClearAll) {
    console.warn('Элементы фильтра не найдены в DOM.');
    return;
  }

  panel.style.display = 'none';
  categoryPanel.style.display = 'none';

  const rangeMin = minQuantity;
  const rangeMax = (minQuantity === maxQuantity) ? (maxQuantity + 1) : maxQuantity;

  [fromRange, toRange].forEach(el => {
    el.min = rangeMin;
    el.max = rangeMax;
    el.step = 1;
  });

  [fromInput, toInput].forEach(el => {
    el.min = rangeMin;
    el.max = rangeMax;
    el.step = 1;
  });

  currentFromQuantity = rangeMin;
  currentToQuantity = rangeMax;

  fromRange.value = currentFromQuantity;
  toRange.value = currentToQuantity;
  fromInput.value = currentFromQuantity;
  toInput.value = currentToQuantity;

  updateLabel(currentFromQuantity, currentToQuantity);
  setWarning(false);

  categoryList.innerHTML = '';
  categories.forEach(category => {
    const label = document.createElement('label');
    label.className = 'category-check-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = category;
    checkbox.checked = false;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCategories.add(category);
      } else {
        selectedCategories.delete(category);
      }
      applyFilter(currentFromQuantity, currentToQuantity, objectManager);
    });

    const text = document.createElement('span');
    text.textContent = category;

    label.appendChild(checkbox);
    label.appendChild(text);
    categoryList.appendChild(label);
  });

  toggleBtn.addEventListener('click', () => {
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) categoryPanel.style.display = 'none';
  });

  categoryToggleBtn.addEventListener('click', () => {
    const isOpen = categoryPanel.style.display === 'block';
    categoryPanel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) panel.style.display = 'none';
  });

  showGibdd = true;
  gibddToggle.classList.add('active');

  gibddToggle.addEventListener('click', () => {
    showGibdd = !showGibdd;
    gibddToggle.classList.toggle('active', showGibdd);
    applyFilter(currentFromQuantity, currentToQuantity, objectManager);
  });

  btnSelectAll.addEventListener('click', () => {
    const excluded = new Set(['Tm', 'Tb']);

    selectedCategories = new Set(
      categories.filter(category => !excluded.has(category))
    );

    categoryList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = !excluded.has(cb.value);
    });

    applyFilter(currentFromQuantity, currentToQuantity, objectManager);
  });

  btnClearAll.addEventListener('click', () => {
    selectedCategories.clear();
    categoryList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });

    applyFilter(currentFromQuantity, currentToQuantity, objectManager);
  });

  function setWarning(isBad) {
    warning.style.display = isBad ? 'block' : 'none';
  }

  function clampHard(v) {
    if (!Number.isFinite(v)) v = rangeMin;
    if (v < rangeMin) v = rangeMin;
    if (v > rangeMax) v = rangeMax;
    return v;
  }

  function readSoftInt(v) {
    const s = String(v ?? '').trim();
    if (s === '') return null;
    if (!/^\d+$/.test(s)) return null;
    return parseInt(s, 10);
  }

  function syncSlidersSoft(fromVal, toVal) {
    if (fromVal !== null) fromRange.value = clampHard(fromVal);
    if (toVal !== null) toRange.value = clampHard(toVal);
  }

  function tryApply(fromVal, toVal, mode) {
    const isValid = (fromVal !== null && toVal !== null && fromVal <= toVal);

    setWarning(!isValid);

    if (mode === 'typing') {
      if (isValid) {
        currentFromQuantity = clampHard(fromVal);
        currentToQuantity = clampHard(toVal);

        fromRange.value = currentFromQuantity;
        toRange.value = currentToQuantity;

        updateLabel(currentFromQuantity, currentToQuantity);
        applyFilter(currentFromQuantity, currentToQuantity, objectManager);
      }
      return;
    }

    let f = (fromVal === null) ? currentFromQuantity : clampHard(fromVal);
    let t = (toVal === null) ? currentToQuantity : clampHard(toVal);
    if (t < f) t = f;

    currentFromQuantity = f;
    currentToQuantity = t;

    fromInput.value = f;
    toInput.value = t;
    fromRange.value = f;
    toRange.value = t;

    setWarning(false);
    updateLabel(f, t);
    applyFilter(f, t, objectManager);
  }

  fromRange.addEventListener('input', () => {
    const f = clampHard(parseInt(fromRange.value, 10));
    const t = clampHard(parseInt(toRange.value, 10));
    const tt = Math.max(f, t);

    fromInput.value = f;
    toInput.value = tt;

    tryApply(f, tt, 'typing');
  });

  toRange.addEventListener('input', () => {
    const f = clampHard(parseInt(fromRange.value, 10));
    const t = clampHard(parseInt(toRange.value, 10));
    const tt = Math.max(f, t);

    fromInput.value = f;
    toInput.value = tt;

    tryApply(f, tt, 'typing');
  });

  fromInput.addEventListener('input', () => {
    const f = readSoftInt(fromInput.value);
    const t = readSoftInt(toInput.value);
    syncSlidersSoft(f, t);
    tryApply(f, t, 'typing');
  });

  toInput.addEventListener('input', () => {
    const f = readSoftInt(fromInput.value);
    const t = readSoftInt(toInput.value);
    syncSlidersSoft(f, t);
    tryApply(f, t, 'typing');
  });

  function commit() {
    const f = readSoftInt(fromInput.value);
    const t = readSoftInt(toInput.value);
    tryApply(f, t, 'commit');
  }

  fromInput.addEventListener('change', commit);
  toInput.addEventListener('change', commit);
  fromInput.addEventListener('blur', commit);
  toInput.addEventListener('blur', commit);

  [fromInput, toInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        inp.blur();
      }
    });
  });

  function updateLabel(fromVal, toVal) {
    currentValueLabel.textContent = `Показываются точки с кол-вом от ${fromVal} до ${toVal}`;
  }

  applyFilter(currentFromQuantity, currentToQuantity, objectManager);
}

function applyFilter(fromQty, toQty, objectManager) {
  currentFromQuantity = fromQty;
  currentToQuantity = toQty;

  if (!objectManager) return;

  const selectedCount = selectedCategories.size;
  const allCountWithoutTmTb = allCategories.filter(cat => cat !== 'Tm' && cat !== 'Tb').length;

  objectManager.setFilter(obj => {
    const preset = obj.options && obj.options.preset;
    const isBlue = preset === 'islands#blueIcon';

    // ГИБДД фильтруется только кнопкой
    if (isBlue) {
      return showGibdd;
    }

    const objCategories = extractCategories(obj);

    const categoryFilterIsOff =
      selectedCount === 0 || selectedCount === allCountWithoutTmTb;

    if (!categoryFilterIsOff) {
      for (const selected of selectedCategories) {
        if (!objCategories.includes(selected)) {
          return false;
        }
      }
    }

    const q = extractQuantity(obj);
    if (q === null) return false;

    return q >= currentFromQuantity && q <= currentToQuantity;
  });
}
// ── 상수 ──────────────────────────────────
const MONTH_NAMES = ["","1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const MONTH_SHORT = ["","1","2","3","4","5","6","7","8","9","10","11","12"];
const HOME_CENTER = [20, 148];
const HOME_ZOOM   = 2;

let SPOTS = []; // spots.json 로드 후 채워짐

// ── Map ───────────────────────────────────
const map = L.map('map', {
  center: HOME_CENTER,
  zoom: HOME_ZOOM,
  minZoom: 2,
  maxZoom: 14,
  zoomControl: false,
  worldCopyJump: false
});

L.control.zoom({ position: 'topright' }).addTo(map);

// 위성 타일 (ESRI WorldImagery — 무료, API 키 불필요)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community',
  maxZoom: 19
}).addTo(map);

// Legend
const legendCtrl = L.control({ position: 'bottomleft' });
legendCtrl.onAdd = () => {
  const d = L.DomUtil.create('div');
  d.innerHTML = `
    <div class="map-legend">
      <h4>Legend</h4>
      <div class="legend-row"><div class="legend-dot" style="background:#3b82f6"></div>이달 추천 스팟</div>
      <div class="legend-row"><div class="legend-dot" style="background:#263547"></div>다른 시즌 스팟</div>
    </div>`;
  return d;
};
legendCtrl.addTo(map);

// ── State ─────────────────────────────────
let selectedMonth  = 0;
let selectedSpotId = null;
const activeMarkers = {}; // { [spotId]: { [offset]: L.Marker } }

// ── Helpers ───────────────────────────────
function isHighlighted(spot) {
  return selectedMonth === 0 || spot.bestMonths.includes(selectedMonth);
}

// country 필드에서 기본 국가명 추출 (· 이전 부분)
function baseCountry(spot) {
  return spot.country.split('·')[0].trim();
}

// ── Markers ───────────────────────────────
function buildIcon(spot, highlighted) {
  const bg     = highlighted ? spot.color : '#263547';
  const border = highlighted ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
  const pulse  = highlighted
    ? `<div style="position:absolute;inset:0;border-radius:50%;background:${spot.color}40;animation:pulse 2s ease-out infinite;"></div>`
    : '';

  return L.divIcon({
    className: '',
    html: `<div style="
        width:34px;height:34px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        background:${bg};
        border:2px solid ${border};
        display:flex;align-items:center;justify-content:center;
        position:relative;
        box-shadow:${highlighted ? `0 3px 14px ${spot.color}70` : 'none'};
      ">
        ${pulse}
        <span style="transform:rotate(45deg);font-size:15px;line-height:1;position:relative;">${spot.icon}</span>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -38]
  });
}

function buildPopupContent(spot) {
  const bestMonthText = spot.bestMonths.map(m => MONTH_NAMES[m]).join(' · ');
  const allTags = spot.creatures.map(c => `<span class="popup-creature">${c}</span>`).join('');
  return `
    <div class="popup-inner">
      <div class="popup-header">
        <div>
          <div class="popup-name">${spot.icon} ${spot.name}</div>
          <div class="popup-country">📍 ${spot.country} &nbsp;·&nbsp; ⭐ ${spot.difficulty}</div>
        </div>
        <div class="popup-header-btns">
          <button class="popup-btn home" onclick="flyHome()" title="전체 보기">⊙ 전체</button>
          <button class="popup-btn" onclick="justClose()">✕</button>
        </div>
      </div>
      <div class="popup-scroll">
        <div class="popup-stats-grid">
          <div class="popup-stat-box"><div class="popup-stat-icon">🏊</div><div class="popup-stat-label">수심</div><div class="popup-stat-val">${spot.depth}</div></div>
          <div class="popup-stat-box"><div class="popup-stat-icon">👁</div><div class="popup-stat-label">시야</div><div class="popup-stat-val">${spot.visibility}</div></div>
          <div class="popup-stat-box"><div class="popup-stat-icon">🌡</div><div class="popup-stat-label">수온</div><div class="popup-stat-val">${spot.waterTemp}</div></div>
        </div>
        <div class="popup-section-label">Best Season</div>
        <div class="popup-season-bar">${bestMonthText}</div>
        <div class="popup-section-label">소개</div>
        <div class="popup-desc">${spot.desc}</div>
        <div class="popup-section-label">주요 해양 생물</div>
        <div class="popup-creatures">${allTags}</div>
      </div>
    </div>`;
}

// ── Dynamic World-Copy Markers ─────────────
function visibleOffsets() {
  const b    = map.getBounds();
  const west = b.getWest(), east = b.getEast();
  const kMin = Math.ceil((west - 180) / 360);
  const kMax = Math.floor((east + 180) / 360);
  const result = [];
  for (let k = kMin; k <= kMax; k++) result.push(k * 360);
  return result;
}

function renderMarkers() {
  const needed = new Set(visibleOffsets());
  // 월 필터 시 하이라이트된 스팟만 지도에 표시
  const visibleSpots = selectedMonth === 0
    ? SPOTS
    : SPOTS.filter(s => isHighlighted(s));

  // 숨겨져야 할 스팟의 마커 제거
  SPOTS.forEach(spot => {
    if (!visibleSpots.includes(spot) && activeMarkers[spot.id]) {
      Object.values(activeMarkers[spot.id]).forEach(m => m.remove());
      activeMarkers[spot.id] = {};
    }
  });

  visibleSpots.forEach(spot => {
    if (!activeMarkers[spot.id]) activeMarkers[spot.id] = {};
    const hl   = isHighlighted(spot);
    const icon = buildIcon(spot, hl);

    needed.forEach(offset => {
      if (activeMarkers[spot.id][offset]) {
        activeMarkers[spot.id][offset].setIcon(icon);
        activeMarkers[spot.id][offset].setZIndexOffset(hl ? 1000 : 0);
      } else {
        const m = L.marker([spot.lat, spot.lng + offset], { icon })
          .addTo(map)
          .bindPopup(buildPopupContent(spot), { maxWidth: 420, minWidth: 400, autoPanPadding: [30, 30] });
        m.on('click', () => selectSpot(spot.id));
        activeMarkers[spot.id][offset] = m;
      }
    });

    Object.keys(activeMarkers[spot.id]).forEach(k => {
      const offset = Number(k);
      if (!needed.has(offset)) {
        activeMarkers[spot.id][offset].remove();
        delete activeMarkers[spot.id][offset];
      }
    });
  });
}

map.on('moveend', renderMarkers);

// ── Popup Helpers ─────────────────────────
function closestMarker(id) {
  const centerLng = map.getCenter().lng;
  const set = Object.values(activeMarkers[id] || {});
  if (!set.length) return null;
  return set.reduce((best, m) => {
    const d  = Math.abs(m.getLatLng().lng - centerLng);
    const db = Math.abs(best.getLatLng().lng - centerLng);
    return d < db ? m : best;
  });
}

function justClose() {
  map.closePopup();
  selectedSpotId = null;
  document.querySelectorAll('.spot-card').forEach(c => c.classList.remove('active'));
}

function flyHome() {
  map.closePopup();
  map.flyTo(HOME_CENTER, HOME_ZOOM, { duration: 1.0 });
  selectedSpotId = null;
  document.querySelectorAll('.spot-card').forEach(c => c.classList.remove('active'));
}

function closePopup() { justClose(); }

// ── Select Spot ───────────────────────────
function selectSpot(id) {
  selectedSpotId = id;

  document.querySelectorAll('.spot-card').forEach(c =>
    c.classList.toggle('active', parseInt(c.dataset.id) === id)
  );
  const activeCard = document.querySelector('.spot-card.active');
  if (activeCard) activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const target = closestMarker(id);
  if (!target) return;
  const latlng = target.getLatLng();

  // 팝업이 마커 위에 뜨므로 flyTo 목표를 위로 올려 마커가 화면 하단에 위치하도록 함
  const POPUP_OFFSET_DEG = 0.55;
  const flyCenter = L.latLng(latlng.lat + POPUP_OFFSET_DEG, latlng.lng);
  map.flyTo(flyCenter, 6, { duration: 1.2 });

  setTimeout(() => target.openPopup(), 1300);
}

// ── Stats (JSON 기반 동적 계산) ────────────
function calcStats() {
  const hlCount         = (selectedMonth === 0 ? SPOTS : SPOTS.filter(s => isHighlighted(s))).length;
  const uniqueCreatures = new Set(SPOTS.flatMap(s => s.creatures)).size;
  const countryCount    = new Set(SPOTS.map(s => baseCountry(s))).size;

  document.getElementById('stat-total').textContent      = SPOTS.length;
  document.getElementById('stat-highlight').textContent  = hlCount;
  document.getElementById('stat-creatures').textContent  = uniqueCreatures + '+';
  document.getElementById('stat-continents').textContent = countryCount;

  document.getElementById('panel-subtitle').textContent =
    selectedMonth === 0
      ? `전세계 ${SPOTS.length}개 베스트 포인트`
      : `${MONTH_NAMES[selectedMonth]} 추천 ${hlCount}개 스팟`;

  // 모바일 시트 동기화
  const totalM = document.getElementById('stat-total-m');
  const hlM    = document.getElementById('stat-highlight-m');
  const crM    = document.getElementById('stat-creatures-m');
  if (totalM) totalM.textContent = SPOTS.length;
  if (hlM)    hlM.textContent    = hlCount;
  if (crM)    crM.textContent    = uniqueCreatures + '+';
}

// ── Spot List (국가별 그룹, 국가→이름 순 정렬) ──
function renderSpotList() {
  const listEl = document.getElementById('spot-list');
  listEl.innerHTML = '';

  // 표시할 스팟: 월 선택 시 하이라이트만, 전체 선택 시 모두
  const spotsToShow = (selectedMonth === 0 ? SPOTS : SPOTS.filter(s => isHighlighted(s)))
    .slice()
    .sort((a, b) => {
      const ca = baseCountry(a), cb = baseCountry(b);
      if (ca !== cb) return ca.localeCompare(cb, 'ko');
      return a.name.localeCompare(b.name, 'ko');
    });

  // 국가별로 그룹화 (정렬된 순서 유지)
  const countryOrder = [];
  const groups = {};
  spotsToShow.forEach(spot => {
    const key = baseCountry(spot);
    if (!groups[key]) { groups[key] = []; countryOrder.push(key); }
    groups[key].push(spot);
  });

  if (countryOrder.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">이 달에 추천 스팟이 없습니다.</div>`;
  } else {
    countryOrder.forEach(country => {
      // 국가 헤더
      const header = document.createElement('div');
      header.className = 'group-header';
      header.innerHTML = `<span class="group-name">${country}</span><span class="group-count">${groups[country].length}</span>`;
      listEl.appendChild(header);

      // 스팟 카드
      groups[country].forEach(spot => {
        const card = document.createElement('div');
        card.className = `spot-card${selectedSpotId === spot.id ? ' active' : ''}`;
        card.dataset.id = spot.id;

        const pills = spot.bestMonths.map(m =>
          `<span class="month-pill best" title="${MONTH_NAMES[m]}">${MONTH_SHORT[m]}</span>`
        ).join('');
        const tags = spot.creatures.slice(0, 4).map(c => `<span class="creature-tag">${c}</span>`).join('');

        card.innerHTML = `
          <div class="card-top">
            <div>
              <div class="card-name">${spot.icon} ${spot.name}</div>
              <div class="card-country">${spot.country}</div>
            </div>
            <div class="best-months-wrap">${pills}</div>
          </div>
          <div class="card-meta">
            <span>🏊 ${spot.depth}</span>
            <span>👁 ${spot.visibility}</span>
            <span>⭐ ${spot.difficulty}</span>
          </div>
          <div class="card-creatures">${tags}</div>`;

        card.addEventListener('click', () => selectSpot(spot.id));
        listEl.appendChild(card);
      });
    });
  }

  calcStats();
  if (document.getElementById('sheet-body')) syncSheetList();
}

// ── Month Filter ──────────────────────────
document.querySelectorAll('.month-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMonth = parseInt(btn.dataset.month);

    // 선택된 스팟이 이번 달 추천에 없으면 팝업 닫기
    if (selectedSpotId !== null && selectedMonth !== 0) {
      const spot = SPOTS.find(s => s.id === selectedSpotId);
      if (spot && !spot.bestMonths.includes(selectedMonth)) {
        map.closePopup();
        selectedSpotId = null;
      }
    }

    renderMarkers();
    renderSpotList();
  });
});

// ── Mobile Bottom Sheet ───────────────────
let sheetOpen = false;

function toggleSheet(forceOpen) {
  const sheet = document.getElementById('bottom-sheet');
  const fab   = document.getElementById('fab-list');
  sheetOpen = forceOpen !== undefined ? forceOpen : !sheetOpen;
  sheet.classList.toggle('open', sheetOpen);
  fab.textContent = sheetOpen ? '✕ 닫기' : '🤿 목록 보기';
}

function syncSheetList() {
  const sheetBody = document.getElementById('sheet-body');
  const listEl    = document.getElementById('spot-list');
  sheetBody.innerHTML = listEl.innerHTML;
  sheetBody.querySelectorAll('.spot-card').forEach(card => {
    card.addEventListener('click', () => {
      selectSpot(parseInt(card.dataset.id));
      toggleSheet(false);
    });
  });
  const sub = document.getElementById('panel-subtitle').textContent;
  document.getElementById('sheet-subtitle').textContent = sub;
}

// ── Init ──────────────────────────────────
fetch('spots.json')
  .then(r => r.json())
  .then(data => {
    SPOTS = data;
    renderMarkers();
    renderSpotList();
  })
  .catch(err => console.error('spots.json 로드 실패:', err));

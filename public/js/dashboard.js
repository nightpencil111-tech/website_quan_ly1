(function () {
  if (typeof Chart === 'undefined') return;
  var el = document.getElementById('chart-data');
  if (!el) return;
  var data;
  try { data = JSON.parse(el.textContent); } catch (e) { return; }
  var green = '#4b5d2a';
  var light = '#a9b98a';
  var opts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
    plugins: { legend: { position: 'bottom' } },
  };
  var cat = document.getElementById('chart-category');
  if (cat && data.byCategory) {
    new Chart(cat, {
      type: 'bar',
      data: {
        labels: data.byCategory.map(function (x) { return x.label; }),
        datasets: [
          { label: 'Hoàn thành', data: data.byCategory.map(function (x) { return x.done; }), backgroundColor: green },
          { label: 'Chưa hoàn thành', data: data.byCategory.map(function (x) { return x.total - x.done; }), backgroundColor: light },
        ],
      },
      options: opts,
    });
  }
  var per = document.getElementById('chart-person');
  if (per && data.byPerson) {
    new Chart(per, {
      type: 'bar',
      data: {
        labels: data.byPerson.map(function (x) { return x.full_name; }),
        datasets: [
          { label: 'Hoàn thành', data: data.byPerson.map(function (x) { return x.done; }), backgroundColor: green },
          { label: 'Đang thực hiện', data: data.byPerson.map(function (x) { return x.open; }), backgroundColor: light },
        ],
      },
      options: opts,
    });
  }
})();

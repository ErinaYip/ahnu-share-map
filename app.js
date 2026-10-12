document.addEventListener('DOMContentLoaded', () => {
    // === 0. 主题模式切换 ===
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    
    // 初始化主题
    const savedTheme = localStorage.getItem('my_theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeToggleBtn.innerHTML = '☀️ 切换主题';
    }

    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        localStorage.setItem('my_theme', isDark ? 'dark' : 'light');
        themeToggleBtn.innerHTML = isDark ? '☀️ 切换主题' : '🌙 切换主题';
    });

    // === 1. 时间与日期 ===
    const timeEl = document.getElementById('current-time');
    const dateEl = document.getElementById('current-date');

    function updateTime() {
        const now = new Date();
        const timeHTML = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' , second: '2-digit' });
        const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

        timeEl.textContent = timeHTML;
        dateEl.textContent = dateStr;
    }
    setInterval(updateTime, 1000);
    updateTime();

    // === 2. 天气获取 (基于 Open-Meteo API，无需 Key) ===
    const weatherInfoEl = document.getElementById('weather-info');
    const weatherIconEl = document.getElementById('weather-icon');
    const cityInfoEl = document.getElementById('city-info');
    const getWeatherBtn = document.getElementById('get-weather-btn');

    // WMO 天气代码转换图标
    const weatherCodes = {
        0: '☀️', // 晴
        1: '🌤️', 2: '⛅', 3: '☁️', // 多云系
        45: '🌫️', 48: '🌫️', // 雾
        51: '🌧️', 53: '🌧️', 55: '🌧️', // 毛毛雨
        61: '☔', 63: '☔', 65: '☔', // 雨
        71: '❄️', 73: '❄️', 75: '❄️', // 雪
        95: '⛈️', 96: '⛈️', 99: '⛈️' // 雷暴
    };

    async function fetchWeather(lat, lon, savedCity = null) {
        try {
            weatherInfoEl.textContent = '获取中...';
            if (!savedCity) cityInfoEl.textContent = '解析位置中...';
            else cityInfoEl.textContent = savedCity;

            // 获取天气
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
            const res = await fetch(url);
            const data = await res.json();
            const current = data.current_weather;

            weatherInfoEl.textContent = `${current.temperature}°C`;
            weatherIconEl.textContent = weatherCodes[current.weathercode] || '🌡️';

            // 反向地理编码查询城市名（使用国内访问更稳定的免费 API）
            let cityName = savedCity;
            if (!cityName) {
                try {
                    const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`);
                    const geoData = await geoRes.json();
                    console.log('地址信息:', geoData);
                    cityName = geoData.city || geoData.locality || geoData.principalSubdivision || '未知位置';
                } catch (e) {
                    cityName = '未知位置';
                }
                cityInfoEl.textContent = cityName;
            }

            // 保存定位供下次加载使用
            localStorage.setItem('my_location', JSON.stringify({ lat, lon, city: cityName }));

            // 自动将天气插入今日小记
            if (typeof autoAnnotateWeather === 'function') {
                autoAnnotateWeather(weatherIconEl.textContent, current.temperature, cityName);
            }
        } catch (error) {
            weatherInfoEl.textContent = '获取失败';
        }
    }

    getWeatherBtn.addEventListener('click', () => {
        if ('geolocation' in navigator) {
            weatherInfoEl.textContent = '定位中...';
            navigator.geolocation.getCurrentPosition(
                (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
                (err) => { weatherInfoEl.textContent = '定位失败/授权被绝'; }
            );
        } else {
            weatherInfoEl.textContent = '浏览器不支持定位';
        }
    });

    // 初始化时，如果本地缓存有位置记录直接获取天气
    const savedLocation = JSON.parse(localStorage.getItem('my_location'));
    if (savedLocation && savedLocation.lat && savedLocation.lon) {
        fetchWeather(savedLocation.lat, savedLocation.lon, savedLocation.city);
    }

    // === 3. 待办事项：由后端模板直接渲染，这里仅保留数据供日历/导出使用 ===
    const todos = window.__TODOS__ || [];

    // === 4. 每日小记 (基于 LocalStorage 自动保存) 与日历交互 ===
    const notesEl = document.getElementById('daily-notes');
    const previewEl = document.getElementById('notes-preview');
    const togglePreviewBtn = document.getElementById('toggle-preview-btn');
    const statusEl = document.getElementById('save-status');
    const clearNotesBtn = document.getElementById('clear-notes-btn');
    const notesHintEl = document.getElementById('notes-hint');

    let isPreviewMode = false;

    // ===== 格式化日期帮助函数 =====
    function formatDateString(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // 初始化时使用的年月和日期状态
    let baseDate = new Date();
    let currentCalMonth = baseDate.getMonth();
    let currentCalYear = baseDate.getFullYear();
    let selectedDateStr = formatDateString(baseDate); 
    const todayStr = selectedDateStr; // 固定的“今天”

    // 统一切换预览模式的方法
    function setPreviewMode(mode) {
        isPreviewMode = mode;
        if (isPreviewMode) {
            notesEl.style.display = 'none';
            mdToolbar.style.opacity = '0.5';
            mdToolbar.style.pointerEvents = 'none';
            previewEl.style.display = 'block';
            togglePreviewBtn.textContent = '编辑';
            updateMarkdownPreview();
        } else {
            previewEl.style.display = 'none';
            mdToolbar.style.opacity = '1';
            mdToolbar.style.pointerEvents = 'auto';
            notesEl.style.display = 'block';
            togglePreviewBtn.textContent = '预览';
            notesEl.focus();
        }
    }

    // 根据选中的日期加载小记
    function loadNotesForSelectedDate() {
        const key = 'notes_' + selectedDateStr;
        const savedData = localStorage.getItem(key) || '';
        notesEl.value = savedData;
        
        if (selectedDateStr === todayStr) {
            notesHintEl.textContent = '写下今天的感悟吧，数据会自动保存在本地。';
            // 选中的是今天时，默认是编辑模式
            setPreviewMode(false);
        } else {
            notesHintEl.textContent = `查看历史：${selectedDateStr} 的小记`;
            // 选中的是历史日期时，默认渲染为 Markdown 预览
            setPreviewMode(true);
        }
    }

    // 更新 Markdown 预览
    function updateMarkdownPreview() {
        // 使用 marked 解析 textarea 中的内容
        previewEl.innerHTML = marked.parse(notesEl.value || '*(暂无内容)*');
    }

    // Markdown 工具栏交互
    const mdToolbar = document.getElementById('md-toolbar');
    const toolbarBtns = document.querySelectorAll('.toolbar-btn');

    toolbarBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isPreviewMode) return; // 预览模式下工具栏不可用
            
            // 将 HTML 属性中的字面量 '\n' 替换为真实的换行符
            const rawPrefix = btn.getAttribute('data-prefix') || '';
            const rawSuffix = btn.getAttribute('data-suffix') || '';
            const prefix = rawPrefix.replace(/\\n/g, '\n');
            const suffix = rawSuffix.replace(/\\n/g, '\n');
            
            let start = notesEl.selectionStart;
            let end = notesEl.selectionEnd;
            const text = notesEl.value;
            
            let before = text.substring(0, start);
            let selected = text.substring(start, end);
            let after = text.substring(end);
            
            // 检查当前选中文本是否已经有这个样式
            const isWrappedInside = selected.startsWith(prefix) && (suffix === '' || selected.endsWith(suffix));
            const isWrappedOutside = before.endsWith(prefix) && (suffix === '' || after.startsWith(suffix));

            if (isWrappedInside && prefix !== '') {
                // 情况1：样式在选区内部，剥离样式
                selected = selected.substring(prefix.length, selected.length - suffix.length);
                notesEl.value = before + selected + after;
                end = start + selected.length;
            } else if (isWrappedOutside && prefix !== '') {
                // 情况2：样式在选区外部（两侧），剥离样式
                before = before.substring(0, before.length - prefix.length);
                after = after.substring(suffix.length);
                notesEl.value = before + selected + after;
                start = before.length;
                end = start + selected.length;
            } else {
                // 情况3：正常添加样式
                notesEl.value = before + prefix + selected + suffix + after;
                start = before.length + prefix.length;
                end = start + selected.length;
            }
            
            // 重新设置焦点并保持文本处于选中状态，方便连续操作
            notesEl.focus();
            notesEl.setSelectionRange(start, end);
            
            // 手动触发 input 事件以保证自动保存逻辑生效
            notesEl.dispatchEvent(new Event('input'));
        });
    });

    // 切换预览/编辑模式
    togglePreviewBtn.addEventListener('click', () => {
        setPreviewMode(!isPreviewMode);
    });

    // 渲染日历
    const calDaysEl = document.getElementById('calendar-days');
    const calHeaderEl = document.getElementById('calendar-month-year');
    
    function renderCalendar() {
        calDaysEl.innerHTML = '';
        calHeaderEl.textContent = `${currentCalYear}年 ${currentCalMonth + 1}月`;
        
        const firstDayObj = new Date(currentCalYear, currentCalMonth, 1);
        const daysInMonth = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();
        const firstDayIdx = firstDayObj.getDay(); // 0(Sun) - 6(Sat)
        const daysInPrevMonth = new Date(currentCalYear, currentCalMonth, 0).getDate();
        
        // 上个月的剩余天数
        for (let i = firstDayIdx - 1; i >= 0; i--) {
            const d = daysInPrevMonth - i;
            const dateStr = formatDateString(new Date(currentCalYear, currentCalMonth - 1, d));
            calDaysEl.appendChild(createDayElement(d, 'other-month', dateStr));
        }
        
        // 当月天数
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = formatDateString(new Date(currentCalYear, currentCalMonth, i));
            calDaysEl.appendChild(createDayElement(i, 'current-month', dateStr));
        }
        
        // 下个月的天数 (填满6行 = 42格子)
        const totalRendered = firstDayIdx + daysInMonth;
        const nextDays = 42 - totalRendered;
        for (let i = 1; i <= nextDays; i++) {
            const dateStr = formatDateString(new Date(currentCalYear, currentCalMonth + 1, i));
            calDaysEl.appendChild(createDayElement(i, 'other-month', dateStr));
        }
    }

    // 创建一天的 DOM
    function createDayElement(dayNum, extraClass, dateStr) {
        const el = document.createElement('div');
        el.className = `calendar-day ${extraClass}`;
        el.textContent = dayNum;
        
        if (dateStr === selectedDateStr) {
            el.classList.add('selected');
        }
        
        // 检查这一天是否有日记
        const noteData = localStorage.getItem('notes_' + dateStr);
        if (noteData && noteData.trim() !== '') {
            el.classList.add('has-notes'); // 添加日记红点标记
        }
        
        // 检查这一天是否有未完成的待办事项（或者创建与这一天的待办）
        const hasTodos = todos.some(t => t.createdAt === dateStr && !t.completed);
        if (hasTodos) {
            el.classList.add('has-todos'); // 添加待办绿点标记
        }
        
        el.addEventListener('click', () => {
            selectedDateStr = dateStr;
            renderCalendar(); // 重新渲染高亮
            loadNotesForSelectedDate(); // 切换右侧文本框内容
        });
        
        return el;
    }

    // 日历翻月
    document.getElementById('prev-month').addEventListener('click', () => {
        currentCalMonth--;
        if (currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; }
        renderCalendar();
    });
    
    document.getElementById('next-month').addEventListener('click', () => {
        currentCalMonth++;
        if (currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; }
        renderCalendar();
    });

    // 初始加载当前天数的日历和笔记
    renderCalendar();
    loadNotesForSelectedDate();

    // 修改：输入笔记时自动保存对应日期的 Key
    let saveTimeout;
    notesEl.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        statusEl.style.opacity = 0; 
        
        saveTimeout = setTimeout(() => {
            const key = 'notes_' + selectedDateStr;
            const content = notesEl.value;
            
            if (content.trim() === '') {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, content);
            }
            
            statusEl.textContent = '已自动保存于 ' + new Date().toLocaleTimeString('zh-CN');
            statusEl.style.opacity = 1;
            
            // 实时更新日历标记红点
            renderCalendar(); 
        }, 1000); 
    });

    // 修改：清空按钮
    clearNotesBtn.addEventListener('click', () => {
        if (confirm(`确定要清空 ${selectedDateStr} 的笔记吗？`)) {
            notesEl.value = '';
            localStorage.removeItem('notes_' + selectedDateStr);
            if (isPreviewMode) updateMarkdownPreview();
            statusEl.textContent = '已清空';
            statusEl.style.opacity = 1;
            renderCalendar(); // 刷新红点
        }
    });

    // === 5. 数据管理与导出 ===
    function downloadFile(filename, content, type) {
        const blob = new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 5.1 导出所有数据为 JSON（日记/设置来自本地，待办来自后端注入）
    document.getElementById('export-json-btn').addEventListener('click', () => {
        const data = { todos: window.__TODOS__ || [] };
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // 过滤掉无关的外部/其它项目字段（如 docsify 字段）
            if (key.startsWith('docsify.') || key.includes('search.index')) {
                continue;
            }
            data[key] = localStorage.getItem(key);
        }
        const jsonStr = JSON.stringify(data, null, 2);
        downloadFile(`flavalon_backup_${formatDateString(new Date())}.json`, jsonStr, 'application/json');
    });

    // 5.2 导出选定日期的小记为 MD
    document.getElementById('export-day-md-btn').addEventListener('click', () => {
        const content = notesEl.value;
        if (!content.trim()) {
            alert('当前日期没有记录内容哦，写点什么再导出吧！');
            return;
        }
        
        let mdContent = content;
        if (!mdContent.startsWith(`# ${selectedDateStr}`)) {
            mdContent = `# ${selectedDateStr}\n\n` + mdContent;
        }
        downloadFile(`note_${selectedDateStr}.md`, mdContent, 'text/markdown');
    });

    // 5.3 一键导出所有日期的小记为合并的 MD
    document.getElementById('export-all-md-btn').addEventListener('click', () => {
        let allNotes = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('notes_')) {
                const date = key.replace('notes_', '');
                const content = localStorage.getItem(key);
                if (content && content.trim()) {
                    allNotes.push({ date, content });
                }
            }
        }
        
        if (allNotes.length === 0) {
            alert('你还没有记录过任何小记哦！');
            return;
        }
        
        // 按照日期从新到老排序
        allNotes.sort((a, b) => b.date.localeCompare(a.date));
        
        let mergedContent = `# Flavalon 全部小记汇总\n\n`;
        mergedContent += `导出时间：${formatDateString(new Date())}\n\n`;
        
        allNotes.forEach(note => {
            let noteContent = note.content;
            if (noteContent.startsWith(`# ${note.date}`)) {
                // 如果自带H1标题，合并时转为H2
                noteContent = noteContent.replace(new RegExp(`^# ${note.date}`), `## ${note.date}`);
            } else {
                noteContent = `## ${note.date}\n\n` + noteContent;
            }
            mergedContent += `---\n\n${noteContent}\n\n`;
        });
        
        downloadFile(`all_notes_${formatDateString(new Date())}.md`, mergedContent, 'text/markdown');
    });

    // 5.4 导入导出切换与导入功能
    const tabExport = document.getElementById('tab-export');
    const tabImport = document.getElementById('tab-import');
    const exportPanel = document.getElementById('export-panel');
    const importPanel = document.getElementById('import-panel');
    
    tabExport.addEventListener('click', () => {
        tabExport.classList.add('active');
        tabImport.classList.remove('active');
        exportPanel.style.display = 'flex';
        importPanel.style.display = 'none';
    });

    tabImport.addEventListener('click', () => {
        tabImport.classList.add('active');
        tabExport.classList.remove('active');
        importPanel.style.display = 'flex';
        exportPanel.style.display = 'none';
    });

    document.getElementById('import-btn').addEventListener('click', () => {
        const fileInput = document.getElementById('import-file');
        const file = fileInput.files[0];
        if (!file) {
            alert('请先选择一个 Flavalon 的 .json 备份文件！');
            return;
        }

        if (!confirm('警告：导入备份将完全覆盖当前的待办、日记和所有设置！确认继续吗？')) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                delete data.todos; // 待办保存在后端内存，不在此导入

                localStorage.clear(); // 清空当前所有本地缓存
                for (let key in data) {
                    if (data.hasOwnProperty(key)) {
                        localStorage.setItem(key, data[key]);
                    }
                }
                alert('恢复备份成功！页面即将重新加载。');
                location.reload();
            } catch (err) {
                alert('导入失败，文件格式可能已损坏或不是合法的 JSON 文件！');
                console.error(err);
            }
        };
        reader.readAsText(file);
    });

    // === 6. 自动天气标注 ===
    function autoAnnotateWeather(icon, temp, city) {
        const weatherStamp = `# ${todayStr}\n> 📍 位置：${city} | 🌡️ 天气：${icon} ${temp}°C\n\n`;
        const key = 'notes_' + todayStr;
        let todayNotes = localStorage.getItem(key) || '';
        
        // 匹配已有的天气标注：以 "> 📍 位置：" 开头的一行（前面可能带有带日期的标题）
        const weatherReg = /^(?:# \d{4}-\d{2}-\d{2}\n)?(?:> 📍 位置：.*? \| 🌡️ 天气：.*?\n*)/;

        if (weatherReg.test(todayNotes)) {
            // 如果已存在且内容未变，则无需更新
            if (todayNotes.startsWith(weatherStamp)) return;
            todayNotes = todayNotes.replace(weatherReg, weatherStamp);
        } else if (todayNotes.trim() === '') {
            todayNotes = weatherStamp;
        } else if (!todayNotes.startsWith(`# ${todayStr}`)) {
            todayNotes = weatherStamp + todayNotes;
        } else {
            // 只有标题，把天气插进去
            todayNotes = todayNotes.replace(new RegExp(`^# ${todayStr}\n*`), weatherStamp);
        }

        localStorage.setItem(key, todayNotes);

        // 如果用户正好停留在今天的小记页面，我们直接更新文本区显示
        if (selectedDateStr === todayStr) {
            const start = notesEl.selectionStart;
            const end = notesEl.selectionEnd;
            // 更新节点内容
            notesEl.value = todayNotes;
            
            // 如果用户正在编辑文本，恢复选区，避免光标跳跃(需要校正新增字符带来的偏移)
            if (document.activeElement === notesEl) {
                // 如果刚好替换，长度差可能不多，但为求严谨可暂不处理极端情况
                notesEl.setSelectionRange(start, end);
            }
            if (isPreviewMode) {
                updateMarkdownPreview();
            }
        }
        
        // 刷新日历中的小记标记
        renderCalendar();
    }

});
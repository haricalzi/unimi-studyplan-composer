
import { loadData } from './data.js';
import { PlanManager } from './logic.js';

const { createApp, ref, computed, reactive, onMounted, watch } = Vue;

createApp({
    setup() {
        
        const loading = ref(true);
        const initialized = ref(false);
        const data = ref({ exams: [], rules: null });
        const pm = ref(null); // PlanManager instance

        const currentYear = new Date().getFullYear();
        const academicYearDefault = `${currentYear - 1}/${currentYear}`;

        const state = reactive({
            year: academicYearDefault, 
            curriculum: 'FBA',
            plan: [],
            validation: {},
            newExamName: '',
            newExamCFU: 6,
            searchQuery: '' // <--- AGGIUNTO: stringa di ricerca
        });

        const pillars = computed(() => {
            if (!data.value.exams) return [];
            const p = new Set(data.value.exams.map(e => e.pillar || 'Other').filter(p => p));
            return Array.from(p).sort();
        });

const matrix = computed(() => {
    if (!data.value.exams) return [];

    const pMap = {};
    const query = state.searchQuery.toLowerCase().trim();

    // Filtriamo gli esami prima di raggrupparli
    const filteredExams = data.value.exams.filter(e => {
        return e.name.toLowerCase().includes(query);
    });

    filteredExams.forEach(e => {
        const pName = e.pillar || 'Other';
        const sName = e.subpillar || 'General';
        
        if (!pMap[pName]) pMap[pName] = {};
        if (!pMap[pName][sName]) pMap[pName][sName] = { 1: [], 2: [], 3: [] };
        
        pMap[pName][sName][e.period].push(e);
    });

    return Object.keys(pMap).sort().map(pName => ({
        name: pName,
        subpillars: Object.keys(pMap[pName]).sort().map(sName => ({
            name: sName,
            periods: [1, 2, 3].map(pId => ({
                id: pId,
                exams: pMap[pName][sName][pId].sort((a, b) => a.name.localeCompare(b.name))
            }))
        }))
    }));
});

        const sortedTables = computed(() => {
            if (state.curriculum === 'FBA') {
                // return ['1', '2', 'Facoltativi', 'Obbligatori', 'Fuori Piano'];
                return ['Obbligatori', '1', '2', 'Facoltativi', 'Fuori Piano'];
            }
            // return ['A', 'B', 'C', 'Facoltativi', 'Obbligatori', 'Fuori Piano'];
            return ['Obbligatori', 'A', 'B', 'C', 'Facoltativi', 'Fuori Piano'];

        });

        const groupedPlan = computed(() => {
            const groups = {};
            sortedTables.value.forEach(t => groups[t] = []);

            state.plan.forEach(item => {
                if (!groups[item.table]) groups[item.table] = [];
                groups[item.table].push(item);
            });
            return groups;
        });

        const academicYears = computed(() => {
            const years = [];
            const startYear = 2014; // Inizio storico F94
            const endYear = new Date().getFullYear();   // Orizzonte futuro per pianificazione
            
            for (let i = startYear; i <= endYear; i++) {
                const nextYear = (i + 1).toString();
                years.push(`${i}/${nextYear}`);
            }
            return years.reverse(); 
        });

        // Initialize
        onMounted(async () => {
            const loaded = await loadData();
            data.value = loaded;

            // Restore from LS or defaults
            const savedState = localStorage.getItem('studyPlanState');
            pm.value = new PlanManager(loaded.exams, loaded.rules);

            if (savedState) {
                try {
                    const parsed = JSON.parse(savedState);
                    pm.value.setYear(parsed.year);
                    pm.value.setCurriculum(parsed.curriculum);
                    pm.value.plan = parsed.plan; // Restore plan items

                    // Update reactive state
                    state.year = parsed.year;
                    state.curriculum = parsed.curriculum;

                    initialized.value = true;
                } catch (e) {
                    console.error("Failed to restore state", e);
                    pm.value.initDefaults();
                }
            } else {
                pm.value.initDefaults();
            }

            refreshState();
            loading.value = false;
        });

        function refreshState() {
            if (!pm.value) return;
            state.plan = [...pm.value.plan];
            state.validation = pm.value.validate();
            // Save
            saveState();
        }

        function saveState() {
            const toSave = {
                year: state.year,
                curriculum: state.curriculum,
                plan: state.plan
            };
            localStorage.setItem('studyPlanState', JSON.stringify(toSave));
        }

        function setYear(y) {
            state.year = y;
            pm.value.setYear(y);
            refreshState();
        }

        function setCurriculum(c) {
            state.curriculum = c;
            pm.value.setCurriculum(c);
            refreshState();
        }

        function startPlan() {
            setYear(state.year);
            setCurriculum(state.curriculum);
            initialized.value = true;
        }

        // Actions
        function toggleExam(exam) {
            // RIMOSSO: if (!isAvailable(exam)) return; 
            // Ora permettiamo l'aggiunta anche se isAvailable è false

            const inPlan = state.plan.find(p => p.examId === exam.id);
            if (inPlan) {
                pm.value.removeExam(inPlan.id);
            } else {
                pm.value.addExam(exam);
            }
            refreshState();
        }

        function removePlanItem(id) {
            pm.value.removeExam(id);
            refreshState();
        }

        function movePlanItem(id, targetTable) {
            pm.value.moveExam(id, targetTable);
            refreshState();
        }

        function addCustom() {
            if (!state.newExamName || !state.newExamCFU) return;
            pm.value.addCustomExam(state.newExamName, state.newExamCFU);
            
            // Reset dei campi dopo l'aggiunta
            state.newExamName = '';
            state.newExamCFU = 6;
            
            refreshState();
        }

        // Helpers
        function isAvailable(exam) {
            if (!pm.value) return false;
            return pm.value.isExamAvailable(exam);
        }

        function getPossibleTables(planItem) {
            if (!pm.value || planItem.isCustom) return [];
            const exam = data.value.exams.find(e => e.id === planItem.examId);
            if (!exam) return [];
            return pm.value.getAllowedTables(exam);
        }

        function isInPlan(examId) {
            return state.plan.some(p => p.examId === examId);
        }

        function getExamStatusClass(exam) {
            if (isInPlan(exam.id)) return 'selected';
            if (!isAvailable(exam)) return 'disabled';
            return '';
        }

        function getPillarColor(pillar) {
            const colors = {
                'INTERACTION AND MULTIMEDIA': '#f472b6', // pink-400
                'ARTIFICIAL INTELLIGENCE, DATA ANALYTICS AND BIG DATA': '#60a5fa', // blue-400
                'ALGORITHMS, SOFTWARE AND THEORY': '#a78bfa', // violet-400
                'COMPUTING SYSTEMS IN INDUSTRY, BUSINESS AND MEDICINE': '#34d399', // emerald-400
                'Other': '#9ca3af'
            };
            return colors[pillar] || '#cbd5e1';
        }

        function getPillarStyle(pillar) {
             return { borderLeftColor: getPillarColor(pillar) };
        }


        function getNextAvailability(exam) {
            if (!pm.value) return '';
            // Se passiamo un oggetto del piano (che ha examId), cerchiamo l'esame originale
            const target = exam.examId ? data.value.exams.find(e => e.id === exam.examId) : exam;
            return pm.value.getNextAvailabilityInfo(target);
        }

        function getDisplayTables(exam) {
            if (!exam.rawTable) return 'Facoltativo';

            const currentCurriculum = state.curriculum;
            const allTables = exam.rawTable.split('|').map(t => t.trim());

            if (currentCurriculum === 'F94') {
                // Filtra solo A, B, C
                const f94Tables = allTables.filter(t => ['A', 'B', 'C'].includes(t));
                return f94Tables.length > 0 ? f94Tables.join(' | ') : 'Facoltativo';
            } else {
                // Filtra solo 1, 2
                const fbaTables = allTables.filter(t => ['1', '2'].includes(t));
                return fbaTables.length > 0 ? fbaTables.join(' | ') : 'Facoltativo';
            }
        }

        function resetPlan() {
            if (confirm("Sei sicuro di voler resettare il piano? Perderai tutte le selezioni effettuate.")) {
                pm.value.reset();
                refreshState();
            }
        }

        function downloadCSV() {

            function getType(item){
                if (item.isCustom && item.table === 'Obbligatori') return "Mandatory";
                if (item.isCustom) return "Extra";
                return "Curricolar";
            }

            const exportData = state.plan.map(item => {
                const originalExam = data.value.exams.find(e => e.id === item.examId);
                return {
                Exam: item.name,
                CFU: item.cfu,
                "4 month period": originalExam ? originalExam.period : 'N/D',
                Table: item.table,
                Pillar: originalExam ? originalExam.pillar : 'N/D',
                SubPillar: originalExam ? originalExam.subpillar : 'N/D',
                Type: getType(item),
                Link: originalExam ? originalExam.link : '',
            }});

            // Utilizziamo PapaParse (già incluso nel progetto)
            const csv = Papa.unparse(exportData);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement("a");
            link.setAttribute("href", url);
            const filename = `piano_studi_${state.curriculum}_${state.year.replace('/', '-')}.csv`;
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }


        return {
            loading,
            initialized,
            state,
            pillars,
            matrix,
            sortedTables,
            groupedPlan,
            setYear,
            setCurriculum,
            startPlan,
            toggleExam,
            removePlanItem,
            movePlanItem,
            addCustom,
            isAvailable,
            getPossibleTables,
            isInPlan,
            getExamStatusClass,
            getPillarStyle,
            getNextAvailability,
            getDisplayTables,
            academicYears,
            resetPlan,
            downloadCSV
        };
    }
}).mount('#app');

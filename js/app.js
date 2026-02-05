
import { loadData } from './data.js';
import { PlanManager } from './logic.js';

const { createApp, ref, computed, reactive, onMounted, watch } = Vue;

createApp({
    setup() {
        const loading = ref(true);
        const initialized = ref(false);
        const data = ref({ exams: [], rules: null });
        const pm = ref(null); // PlanManager instance

        // Reactive state for UI
        const state = reactive({
            year: '2025/2026',
            curriculum: 'FBA',
            plan: [],
            validation: {}
        });

        const pillars = computed(() => {
            if (!data.value.exams) return [];
            const p = new Set(data.value.exams.map(e => e.pillar || 'Other').filter(p => p));
            return Array.from(p).sort();
        });

        // Matrix: [ { name: 'Pillar', periods: [ { id: 1, exams: [] }, ... ] } ]
        const matrix = computed(() => {
            if (!data.value.exams) return [];

            const m = pillars.value.map(pName => {
                const periods = [1, 2, 3].map(period => {
                    const examsInCell = data.value.exams.filter(e =>
                        (e.pillar === pName || (!e.pillar && pName === 'Other')) &&
                        e.period === period
                    );

                    // Sort exams: Available first, then disabled
                    return {
                        id: period,
                        exams: examsInCell.sort((a, b) => a.name.localeCompare(b.name))
                    };
                });
                return { name: pName, periods };
            });
            return m;
        });

        const sortedTables = computed(() => {
            if (state.curriculum === 'FBA') return ['1', '2', 'Facoltativi', 'Obbligatori'];
            return ['A', 'B', 'C', 'Facoltativi', 'Obbligatori'];
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
            if (!isAvailable(exam)) return;

            // Check if in plan
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

        function addCustom(name, cfu) {
            if (!name || !cfu) return;
            pm.value.addCustomExam(name, cfu);
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
            getPillarStyle
        };
    }
}).mount('#app');

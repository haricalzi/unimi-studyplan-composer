export class PlanManager {
    constructor(exams, rules) {
        this.allExams = exams;
        this.rules = rules;
        this.year = "2025/2026";
        this.curriculum = "FBA";
        this.plan = [];
    }

    setYear(year) {
        this.year = year;
    }

    setCurriculum(curriculum) {
        this.curriculum = curriculum;
        this.migratePlan();
    }

    migratePlan() {
        const newPlan = [];
        for (const item of this.plan) {
            if (item.table === 'Obbligatori') {
                newPlan.push(item);
                continue;
            }
            if (item.isCustom) {
                newPlan.push(item);
                continue;
            }
            const exam = this.allExams.find(e => e.id === item.examId);
            if (!exam) continue;

            const allowed = this.getAllowedTables(exam);
            if (allowed.length > 0) {
                item.table = allowed[0];
                newPlan.push(item);
            } else {
                item.table = 'Facoltativi';
                newPlan.push(item);
            }
        }
        this.plan = newPlan;
        this.rebalanceBuckets();
    }

    getAllowedTables(exam) {
        const raw = exam.rawTable || "";
        const parts = raw.split('|').map(s => s.trim());

        if (this.curriculum === 'FBA') {
            return parts.filter(p => ['1', '2'].includes(p));
        } else {
            const allowed = parts.filter(p => ['A', 'B', 'C'].includes(p));
            const priority = { 'A': 1, 'B': 2, 'C': 3 };
            return allowed.sort((a, b) => priority[a] - priority[b]);
        }
    }

    isExamAvailable(exam) {
        const avail = exam.availability;
        if (!avail || avail.toLowerCase() === 'enabled') return true;
        if (avail.toLowerCase() === 'disabled') return false;

        if (avail.startsWith('From ')) {
            const fromYear = avail.replace('From ', '').trim();
            const currentStart = parseInt(this.year.split('/')[0]);
            const fromStart = parseInt(fromYear.split('/')[0]);
            return currentStart >= fromStart;
        }

        if (avail.includes('Biennial')) {
            const currentStart = parseInt(this.year.split('/')[0]);
            const isEvenYear = (currentStart % 2 === 0);
            if (avail.includes('Even')) return isEvenYear;
            if (avail.includes('Odd')) return !isEvenYear;
        }
        return true;
    }

    getNextAvailabilityInfo(exam) {
        const avail = exam.availability;
        if (!avail || avail.toLowerCase() === 'enabled') return null;

        if (avail.startsWith('From ')) return `Disponibile dal ${avail.replace('From ', '')}`;

        if (avail.includes('Biennial')) {
            const currentStart = parseInt(this.year.split('/')[0]);
            const isEvenYear = (currentStart % 2 === 0);
            if (avail.includes('Even') && !isEvenYear) return "Prossima attivazione: Anni Pari (es. 2026/27)";
            if (avail.includes('Odd') && isEvenYear) return "Prossima attivazione: Anni Dispari (es. 2027/28)";
        }
        return avail;
    }

    addExam(exam, targetTable = null) {
        if (this.plan.some(p => p.examId === exam.id)) return false;

        let table = targetTable;
        if (!table) {
            const allowed = this.getAllowedTables(exam);
            table = allowed.length > 0 ? allowed[0] : 'Facoltativi';
        }

        this.plan.push({
            id: exam.id,
            examId: exam.id,
            name: exam.name,
            cfu: exam.cfu,
            table: table,
            isCustom: false
        });
        this.rebalanceBuckets();
        return true;
    }

    addCustomExam(name, cfu, table = 'Facoltativi') {
        this.plan.push({
            id: 'custom-' + Date.now(),
            examId: null,
            name: name,
            cfu: parseInt(cfu),
            table: table,
            isCustom: true
        });
        this.rebalanceBuckets();
    }

    removeExam(planItemId) {
        const item = this.plan.find(p => p.id === planItemId);
        if (item && item.table === 'Obbligatori') return;

        this.plan = this.plan.filter(p => p.id !== planItemId);
        this.rebalanceBuckets();
    }

    moveExam(planItemId, newTable) {
        const item = this.plan.find(p => p.id === planItemId);
        if (item && !item.isCustom && newTable !== 'Facoltativi' && newTable !== 'Obbligatori' && newTable !== 'Fuori Piano') {
            const exam = this.allExams.find(e => e.id === item.examId);
            const allowed = this.getAllowedTables(exam);
            if (!allowed.includes(newTable)) return false;
        }
        if (item) item.table = newTable;
        this.rebalanceBuckets();
        return true;
    }

rebalanceBuckets() {
    const common = this.rules.degree_requirements.common_rules;
    const progRules = this.rules.degree_requirements.programs[this.curriculum].curriculum_rules;
    
    // 1. Mappiamo i limiti e identifichiamo le regole di somma (es. BC)
    const limits = {};
    let minSumBC = 0;
    progRules.forEach(r => {
        if (r.source === 'BC') minSumBC = r.min_sumBC_credits;
        else limits[r.source] = r.min_credits;
    });
    const freeLimit = common.free_exams_credits;

    const newPlan = [];
    const mandatoryItems = this.plan.filter(p => p.table === 'Obbligatori');
    newPlan.push(...mandatoryItems);
    
    const activeExams = this.plan.filter(p => p.table !== 'Obbligatori');

    activeExams.forEach(item => {
        const exam = this.allExams.find(e => e.id === item.examId);
        const allowed = item.isCustom ? [] : this.getAllowedTables(exam);
        let assigned = false;

        // --- TENTATIVO 1: Tabelle di indirizzo (A, B, C...) ---
        for (const t of allowed) {
            const currentInT = newPlan.filter(p => p.table === t).reduce((s, p) => s + p.cfu, 0);
            const currentBCSum = newPlan.filter(p => p.table === 'B' || p.table === 'C').reduce((s, p) => s + p.cfu, 0);
            
            // CONDIZIONE RESTRITTIVA:
            // Entra nella tabella se non ha raggiunto il minimo individuale...
            const underIndividualMin = currentInT < (limits[t] || 0);
            
            // ...OPPURE se è un'eccezione B/C per raggiungere i 48 CFU totali
            const isBCException = (t === 'B' || t === 'C') && currentBCSum < minSumBC;

            if (underIndividualMin || isBCException) {
                item.table = t;
                assigned = true;
                break;
            }
        }

        // --- TENTATIVO 2: Facoltativi (esattamente 12 CFU) ---
        if (!assigned) {
            const currentInFac = newPlan.filter(p => p.table === 'Facoltativi').reduce((s, p) => s + p.cfu, 0);
            if (currentInFac < freeLimit) {
                item.table = 'Facoltativi';
                assigned = true;
            }
        }

        // --- TENTATIVO 3: Fuori Piano ---
        // Se non è servito a colmare i minimi o la regola B+C, va fuori piano
        if (!assigned) {
            item.table = 'Fuori Piano';
        }

        newPlan.push(item);
    });

    this.plan = newPlan;
}

validate() {
    const common = this.rules.degree_requirements.common_rules;
    const report = { totalCredits: 0, tables: {}, specialRules: [], isValid: true, messages: [] };
    const schema = this.curriculum === 'FBA'
        ? ['Obbligatori', '1', '2', 'Facoltativi', 'Fuori Piano']
        : ['Obbligatori', 'A', 'B', 'C', 'Facoltativi', 'Fuori Piano'];

    schema.forEach(t => report.tables[t] = { current: 0, min: 0 });

    this.plan.forEach(item => {
        if (item.table !== 'Fuori Piano') report.totalCredits += item.cfu;
        report.tables[item.table].current += item.cfu;
    });

    // Validazione Standard (Obbligatori e Facoltativi)
    report.tables['Obbligatori'].min = common.mandatory_exams.reduce((s, e) => s + e.credits, 0);
    report.tables['Facoltativi'].min = common.free_exams_credits;

    // Carichiamo regole dal JSON
    const progRules = this.rules.degree_requirements.programs[this.curriculum].curriculum_rules;
    progRules.forEach(rule => {
        if (rule.source === 'BC') {
            const currentBC = report.tables['B'].current + report.tables['C'].current;
            report.specialRules.push({
                label: 'Somma Tabelle B + C',
                current: currentBC,
                min: rule.min_sumBC_credits
            });
            if (currentBC < rule.min_sumBC_credits) {
                report.isValid = false;
                report.messages.push(`Somma delle tabelle B e C insufficiente: mancano ${rule.min_sumBC_credits - currentBC} CFU`);
            }
        } else {
            const t = rule.source;
            if (report.tables[t]) {
                report.tables[t].min = rule.min_credits;
                if (report.tables[t].current < rule.min_credits) {
                    report.isValid = false;
                    report.messages.push(`Tabella ${t}: Mancano ${rule.min_credits - report.tables[t].current} CFU`);
                }
            }
        }
    });

    // Validazione messaggi base
    if (report.tables['Obbligatori'].current < report.tables['Obbligatori'].min) {
        report.isValid = false;
        report.messages.push(`Obbligatori: Piano incompleto`);
    }
    if (report.totalCredits < common.total_credits) {
        report.isValid = false;
        report.messages.push(`Totale: ${report.totalCredits}/${common.total_credits} CFU`);
    }

    return report;
}

    initDefaults() {
        const mandatory = this.rules.degree_requirements.common_rules.mandatory_exams;
        mandatory.forEach(ex => {
            this.plan.push({
                id: ex.name.toLowerCase().replace(/\s+/g, '-'),
                examId: null,
                name: ex.name,
                cfu: ex.credits,
                table: 'Obbligatori',
                isCustom: true
            });
        });
        this.rebalanceBuckets();
    }
}
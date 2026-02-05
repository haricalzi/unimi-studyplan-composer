
export class PlanManager {
    constructor(exams, rules) {
        this.allExams = exams;
        this.rules = rules;
        this.year = "2025/2026"; // Default
        this.curriculum = "FBA"; // Default

        // The plan stores items: { id, examId, name, cfu, table, isCustom, ... }
        this.plan = [];

        // Initialize with mandatory exams (Thesis, English) logic?
        // Usually these are pre-filled or handled separately.
        // Strategy says "disponiamo di 2 tabelle aggiuntive ... Obbligatori"
        // so we can initialize them.
    }

    setYear(year) {
        this.year = year;
    }

    setCurriculum(curriculum) {
        this.curriculum = curriculum;
        // When switching curriculum, we might need to re-validate or re-assign tables.
        // For simplicity, we might warn user or clear incompatible exams.
        // Strategy says "FBA immatricolati 2025...", "F94 ...".
        // If we switch, we should probably reset or re-evaluate.
        // We will try to migrate valid exams.
        this.migratePlan();
    }

    migratePlan() {
        // Re-assign tables based on new curriculum
        const newPlan = [];
        for (const item of this.plan) {
            if (item.table === 'Obbligatori' || item.table === 'Facoltativi') {
                newPlan.push(item); // Keep optional/mandatory
                continue;
            }

            // Try to find new home for core exams
            if (item.isCustom) {
                newPlan.push(item);
                continue;
            }

            const exam = this.allExams.find(e => e.id === item.examId);
            if (!exam) continue;

            const allowed = this.getAllowedTables(exam);
            if (allowed.length > 0) {
                // Assign to first priority
                item.table = allowed[0];
                newPlan.push(item);
            } else {
                // If not allowed in core tables, move to Optional?
                // Strategy: "Exams present only in FBA can be added by F94 students ONLY in the optional table"
                // So if it loses core status, move to Optional.
                item.table = 'Facoltativi';
                newPlan.push(item);
            }
        }
        this.plan = newPlan;
    }

    getAllowedTables(exam) {
        const raw = exam.rawTable || "";
        const parts = raw.split('|').map(s => s.trim());

        if (this.curriculum === 'FBA') {
            // FBA tables: 1, 2.
            const allowed = parts.filter(p => ['1', '2'].includes(p));
            return allowed; // Disjoint, usually 1 or 2
        } else {
            // F94 tables: A, B, C.
            // Priority A > B > C.
            const allowed = parts.filter(p => ['A', 'B', 'C'].includes(p));
            // Sort by priority A, B, C
            const priority = { 'A': 1, 'B': 2, 'C': 3 };
            return allowed.sort((a, b) => priority[a] - priority[b]);
        }
    }

    isExamAvailable(exam) {
        // Check ordinamento
        if (!exam.ordinamento.some(o => o.trim() === this.curriculum)) {
            // "Exams present only in FBA can be added by F94 students ONLY in the optional table"
            // So they are technically "available" but only for optional.
            // But if strictly checking "is this exam valid for this user", yes.
        }

        const avail = exam.availability;
        if (!avail || avail.toLowerCase() === 'enabled') return true;
        if (avail.toLowerCase() === 'disabled') return false;

        // "From YYYY/YYYY"
        if (avail.startsWith('From ')) {
            const fromYear = avail.replace('From ', '').trim();
            // Compare start years. 2026/2027 -> 2026.
            const currentStart = parseInt(this.year.split('/')[0]);
            const fromStart = parseInt(fromYear.split('/')[0]);
            return currentStart >= fromStart;
        }

        // "Biennial (Even)" / "(Odd)"
        if (avail.includes('Biennial')) {
            const currentStart = parseInt(this.year.split('/')[0]);
            const isEvenYear = (currentStart % 2 === 0);
            if (avail.includes('Even')) return isEvenYear;
            if (avail.includes('Odd')) return !isEvenYear;
        }

        return true;
    }

    addExam(exam, targetTable = null) {
        // Check if already present
        if (this.plan.some(p => p.examId === exam.id)) {
            return false; // Already added
        }

        let table = targetTable;
        if (!table) {
            // Auto-assign
            const allowed = this.getAllowedTables(exam);
            if (allowed.length > 0) {
                table = allowed[0];
            } else {
                // If not in core tables, maybe optional?
                table = 'Facoltativi';
            }
        }

        // Push to plan
        this.plan.push({
            id: exam.id,
            examId: exam.id,
            name: exam.name,
            cfu: exam.cfu,
            table: table,
            isCustom: false
        });
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
    }

    removeExam(planItemId) {
        this.plan = this.plan.filter(p => p.id !== planItemId);
    }

    moveExam(planItemId, newTable) {
        const item = this.plan.find(p => p.id === planItemId);
        if (item) {
            // If moving to core tables, check if allowed
            if (newTable !== 'Facoltativi' && newTable !== 'Obbligatori' && !item.isCustom) {
                const exam = this.allExams.find(e => e.id === item.examId);
                const allowed = this.getAllowedTables(exam);
                if (!allowed.includes(newTable)) {
                    // Not allowed in this specific core table
                    // But F94 allows manual move?
                    // Strategy: "permettendo lo spostamento manuale".
                    // Usually this implies moving between valid tables (e.g. if A|B, move from A to B).
                    // Can I move an A-only exam to B? Usually no.
                    // I will restrict to allowed tables.
                    console.warn(`Cannot move ${item.name} to ${newTable}`);
                    return false;
                }
            }
            item.table = newTable;
            return true;
        }
        return false;
    }

    validate() {
        // Validate against rules
        const report = {
            totalCredits: 0,
            tables: {},
            isValid: true,
            messages: []
        };

        // Initialize tables stats
        // FBA: 1, 2, Facoltativi, Obbligatori
        // F94: A, B, C, Facoltativi, Obbligatori
        const schema = this.curriculum === 'FBA'
            ? ['1', '2', 'Facoltativi', 'Obbligatori']
            : ['A', 'B', 'C', 'Facoltativi', 'Obbligatori'];

        schema.forEach(t => {
            report.tables[t] = { current: 0, min: 0, max: null };
        });

        // Sum credits
        this.plan.forEach(item => {
            report.totalCredits += item.cfu;
            if (!report.tables[item.table]) {
                 report.tables[item.table] = { current: 0, min: 0, max: null };
            }
            report.tables[item.table].current += item.cfu;
        });

        // Check Rules
        const progRules = this.rules.degree_requirements.programs[this.curriculum].curriculum_rules;

        // Core Rules
        progRules.forEach(rule => {
            if (rule.source === 'ABC') return; // Handle later

            const tableCode = rule.source;
            if (report.tables[tableCode]) {
                report.tables[tableCode].min = rule.min_credits;
                if (report.tables[tableCode].current < rule.min_credits) {
                    report.isValid = false;
                    report.messages.push(`Tabella ${tableCode}: Richiesti min ${rule.min_credits} CFU (Attuali: ${report.tables[tableCode].current})`);
                }
            }
        });

        // F94 Additional ABC
        if (this.curriculum === 'F94') {
             // Logic: A+B+C >= minA + minB + minC + 12
             // minA=18, minB=30, minC=12. Sum=60.
             // Target = 60+12 = 72.
             const sumABC = (report.tables['A']?.current || 0) +
                            (report.tables['B']?.current || 0) +
                            (report.tables['C']?.current || 0);
             if (sumABC < 72) {
                 report.isValid = false;
                 report.messages.push(`Totale A+B+C: Richiesti min 72 CFU (Attuali: ${sumABC})`);
             }
        }

        // Optional (Facoltativi)
        // Strategy says "12 CFU facoltativi"
        // Rules do not explicitly list "Facoltativi" min credits in the structure provided?
        // Wait, "common_rules" has total 120.
        // I will assume Min 12 for Facoltativi based on strategy text.
        if (report.tables['Facoltativi']) {
            report.tables['Facoltativi'].min = 12;
            if (report.tables['Facoltativi'].current < 12) {
                 report.isValid = false;
                 report.messages.push(`Facoltativi: Richiesti min 12 CFU (Attuali: ${report.tables['Facoltativi'].current})`);
            }
        }

        // Mandatory
        // English (3) + Thesis (39) = 42.
        // We can check if they are present or just sum.
        // Assuming we pre-fill them or user adds them.
        if (report.tables['Obbligatori']) {
            report.tables['Obbligatori'].min = 42;
             if (report.tables['Obbligatori'].current < 42) {
                 report.isValid = false;
                 report.messages.push(`Obbligatori: Richiesti min 42 CFU (Attuali: ${report.tables['Obbligatori'].current})`);
            }
        }

        // Total 120
        if (report.totalCredits < 120) {
            report.isValid = false;
             report.messages.push(`Totale Crediti: Richiesti 120 CFU (Attuali: ${report.totalCredits})`);
        }

        return report;
    }

    // Initialize default plan (Obbligatori)
    initDefaults() {
        // English
        this.plan.push({
            id: 'english',
            examId: null,
            name: 'English Placement Test',
            cfu: 3,
            table: 'Obbligatori',
            isCustom: true // Treat as custom/system
        });
        // Thesis
        this.plan.push({
            id: 'thesis',
            examId: null,
            name: 'Thesis',
            cfu: 39,
            table: 'Obbligatori',
            isCustom: true
        });
    }
}

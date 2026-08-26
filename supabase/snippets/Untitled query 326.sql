-- Seed content for CME Prep.
-- Realistic Guyana Medical Board / Exit Exam style MCQs across four subjects.
-- Admin bootstrap: register through the app, then run
--   update profiles set role = 'admin' where id = '<your-uuid>';

-- ── Subjects ────────────────────────────────────────────────
insert into subjects (id, name, position) values
  ('11111111-1111-1111-1111-111111111111', 'Medicine', 1),
  ('22222222-2222-2222-2222-222222222222', 'Surgery', 2),
  ('33333333-3333-3333-3333-333333333333', 'Obstetrics & Gynaecology', 3),
  ('44444444-4444-4444-4444-444444444444', 'Paediatrics', 4);

-- ── Topics ──────────────────────────────────────────────────
insert into topics (id, subject_id, name, position) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cardiology', 1),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Endocrinology', 2),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Infectious Disease', 3),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'General Surgery', 1),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Trauma', 2),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Obstetrics', 1),
  ('a3000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Gynaecology', 2),
  ('a4000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Neonatology', 1),
  ('a4000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Paediatric Infectious Disease', 2);

-- ── Questions + options ─────────────────────────────────────
-- Helper pattern: each question is one insert; its options follow. All
-- questions are published so trial/student users can build tests immediately.

-- Q1 (Cardiology, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'mcq_single', 'medium',
 'A 58-year-old man presents with crushing central chest pain radiating to the left arm for 40 minutes. His ECG shows ST-segment elevation in leads II, III and aVF. Which coronary artery is most likely occluded?',
 'ST elevation in the inferior leads (II, III, aVF) localises to the right coronary artery in the majority of patients, as it supplies the inferior wall of the left ventricle. Reciprocal ST depression is often seen in the lateral leads.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000001', 'Right coronary artery', true, 0),
('c0000000-0000-0000-0000-000000000001', 'Left anterior descending artery', false, 1),
('c0000000-0000-0000-0000-000000000001', 'Left circumflex artery', false, 2),
('c0000000-0000-0000-0000-000000000001', 'Left main stem', false, 3);

-- Q2 (Cardiology, single, easy)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'mcq_single', 'easy',
 'Which of the following is the first-line antihypertensive for an otherwise healthy 45-year-old of African descent with newly diagnosed stage 2 hypertension and no compelling indications?',
 'For patients of African/Caribbean descent without diabetes, a calcium channel blocker (e.g. amlodipine) is recommended first-line, as ACE inhibitors are less effective as monotherapy in this group.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000002', 'Amlodipine', true, 0),
('c0000000-0000-0000-0000-000000000002', 'Ramipril', false, 1),
('c0000000-0000-0000-0000-000000000002', 'Bisoprolol', false, 2),
('c0000000-0000-0000-0000-000000000002', 'Furosemide', false, 3);

-- Q3 (Endocrinology, multi, hard)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', 'mcq_multi', 'hard',
 'A 24-year-old woman presents with weight loss, palpitations and heat intolerance. TSH is suppressed and free T4 is elevated. Which of the following findings would support a diagnosis of Graves disease? Select all that apply.',
 'Graves disease is characterised by diffuse goitre, thyroid eye disease (exophthalmos), and positive TSH-receptor antibodies. Pretibial myxoedema is also specific. A single hot nodule on uptake scan suggests a toxic adenoma rather than Graves.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000003', 'Exophthalmos', true, 0),
('c0000000-0000-0000-0000-000000000003', 'Positive TSH-receptor antibodies', true, 1),
('c0000000-0000-0000-0000-000000000003', 'Diffusely increased uptake on radioiodine scan', true, 2),
('c0000000-0000-0000-0000-000000000003', 'A single hot nodule with suppressed surrounding uptake', false, 3);

-- Q4 (Endocrinology, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'mcq_single', 'medium',
 'A 19-year-old with type 1 diabetes is brought in drowsy. Blood glucose 28 mmol/L, pH 7.12, bicarbonate 10 mmol/L, ketones ++. After starting fluids, what is the most important next step?',
 'In diabetic ketoacidosis, fixed-rate IV insulin infusion is started after fluid resuscitation. Potassium must be monitored closely and replaced once it falls, but the priority intervention after fluids is insulin.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000004', 'Fixed-rate intravenous insulin infusion', true, 0),
('c0000000-0000-0000-0000-000000000004', 'Intravenous sodium bicarbonate', false, 1),
('c0000000-0000-0000-0000-000000000004', 'Subcutaneous long-acting insulin only', false, 2),
('c0000000-0000-0000-0000-000000000004', 'Oral metformin', false, 3);

-- Q5 (Infectious Disease, single, medium) — regionally relevant
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003', 'mcq_single', 'medium',
 'A 30-year-old returns to Georgetown from the interior with cyclical fever, rigors and sweats. A thick blood film confirms Plasmodium falciparum. What is the recommended first-line treatment for uncomplicated falciparum malaria?',
 'Artemisinin-based combination therapy (ACT) is first-line for uncomplicated P. falciparum malaria per WHO and Guyana national guidelines. Chloroquine is not used for falciparum due to widespread resistance; IV artesunate is reserved for severe/complicated disease.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000005', 'Artemisinin-based combination therapy', true, 0),
('c0000000-0000-0000-0000-000000000005', 'Oral chloroquine', false, 1),
('c0000000-0000-0000-0000-000000000005', 'Intravenous artesunate', false, 2),
('c0000000-0000-0000-0000-000000000005', 'Primaquine monotherapy', false, 3);

-- Q6 (Infectious Disease, single, easy) — dengue, endemic
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003', 'mcq_single', 'easy',
 'A 22-year-old presents with high fever, severe retro-orbital pain, myalgia and a petechial rash. Platelet count is 90 x10^9/L. Dengue is suspected. Which warning sign most strongly indicates progression to severe dengue?',
 'Persistent vomiting, mucosal bleeding, lethargy, and especially abdominal pain with clinical fluid accumulation are warning signs. Plasma leakage causing a rising haematocrit with a rapid fall in platelets signals progression to severe dengue and the critical phase.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000006', 'Rising haematocrit with rapid fall in platelets', true, 0),
('c0000000-0000-0000-0000-000000000006', 'Fever lasting two days', false, 1),
('c0000000-0000-0000-0000-000000000006', 'Mild headache', false, 2),
('c0000000-0000-0000-0000-000000000006', 'Positive tourniquet test alone', false, 3);

-- Q7 (General Surgery, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000001', 'mcq_single', 'medium',
 'A 34-year-old man presents with 12 hours of periumbilical pain that has migrated to the right iliac fossa, with anorexia and low-grade fever. He has rebound tenderness at McBurney point. What is the most appropriate definitive management?',
 'The clinical picture is classic acute appendicitis. Definitive management is appendicectomy (laparoscopic where available). Antibiotics alone may be considered in selected uncomplicated cases but surgery remains the standard definitive treatment.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000007', 'Appendicectomy', true, 0),
('c0000000-0000-0000-0000-000000000007', 'Outpatient oral antibiotics and review in one week', false, 1),
('c0000000-0000-0000-0000-000000000007', 'Colonoscopy', false, 2),
('c0000000-0000-0000-0000-000000000007', 'Reassurance and discharge', false, 3);

-- Q8 (General Surgery, multi, hard)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000008', 'a2000000-0000-0000-0000-000000000001', 'mcq_multi', 'hard',
 'Which of the following are recognised features of acute mesenteric ischaemia? Select all that apply.',
 'Acute mesenteric ischaemia classically presents with pain out of proportion to examination findings, a metabolic (lactic) acidosis, and often atrial fibrillation as an embolic source. Painless rectal bleeding as the sole feature is more typical of other pathology.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000008', 'Pain out of proportion to clinical findings', true, 0),
('c0000000-0000-0000-0000-000000000008', 'Metabolic acidosis with raised lactate', true, 1),
('c0000000-0000-0000-0000-000000000008', 'Association with atrial fibrillation', true, 2),
('c0000000-0000-0000-0000-000000000008', 'Painless rectal bleeding as the sole presenting feature', false, 3);

-- Q9 (Trauma, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000002', 'mcq_single', 'medium',
 'A motorcyclist arrives after a high-speed collision. He is tachycardic, hypotensive, with distended neck veins and muffled heart sounds. Which life-threatening diagnosis must be treated immediately?',
 'Beck triad (hypotension, distended neck veins, muffled heart sounds) indicates cardiac tamponade, which requires immediate pericardiocentesis or thoracotomy. Tension pneumothorax is a differential but classically shows a hyper-resonant chest with tracheal deviation.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000009', 'Cardiac tamponade', true, 0),
('c0000000-0000-0000-0000-000000000009', 'Simple pneumothorax', false, 1),
('c0000000-0000-0000-0000-000000000009', 'Flail chest', false, 2),
('c0000000-0000-0000-0000-000000000009', 'Pulmonary contusion', false, 3);

-- Q10 (Obstetrics, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001', 'mcq_single', 'medium',
 'A 29-year-old at 34 weeks gestation presents with a blood pressure of 165/110 mmHg, headache and 3+ proteinuria. Which medication is the priority to prevent eclamptic seizures?',
 'Magnesium sulfate is the drug of choice for seizure prophylaxis in severe pre-eclampsia and for treating eclampsia. Antihypertensives such as labetalol control blood pressure but do not prevent seizures.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-00000000000a', 'Magnesium sulfate', true, 0),
('c0000000-0000-0000-0000-00000000000a', 'Labetalol', false, 1),
('c0000000-0000-0000-0000-00000000000a', 'Diazepam', false, 2),
('c0000000-0000-0000-0000-00000000000a', 'Phenytoin', false, 3);

-- Q11 (Obstetrics, single, hard)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-00000000000b', 'a3000000-0000-0000-0000-000000000001', 'mcq_single', 'hard',
 'Immediately after a vaginal delivery, a woman has brisk bleeding estimated at 1200 mL. The uterus is soft and boggy on palpation. After calling for help and starting resuscitation, what is the most appropriate first-line intervention?',
 'The commonest cause of primary postpartum haemorrhage is uterine atony. First-line management is uterine massage and a uterotonic — oxytocin. Balloon tamponade and surgery are escalation steps if bleeding continues.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-00000000000b', 'Uterine massage and intravenous oxytocin', true, 0),
('c0000000-0000-0000-0000-00000000000b', 'Immediate hysterectomy', false, 1),
('c0000000-0000-0000-0000-00000000000b', 'Intrauterine balloon tamponade as the first step', false, 2),
('c0000000-0000-0000-0000-00000000000b', 'Tranexamic acid alone', false, 3);

-- Q12 (Gynaecology, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-00000000000c', 'a3000000-0000-0000-0000-000000000002', 'mcq_single', 'medium',
 'A 26-year-old presents with 6 weeks amenorrhoea, unilateral lower abdominal pain and light vaginal bleeding. A urine pregnancy test is positive. Transvaginal ultrasound shows an empty uterus. What is the most likely diagnosis?',
 'A positive pregnancy test with an empty uterus and unilateral pain is an ectopic pregnancy until proven otherwise. Serial beta-hCG and ultrasound guide management; this is a surgical emergency if ruptured.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-00000000000c', 'Ectopic pregnancy', true, 0),
('c0000000-0000-0000-0000-00000000000c', 'Complete miscarriage', false, 1),
('c0000000-0000-0000-0000-00000000000c', 'Threatened miscarriage', false, 2),
('c0000000-0000-0000-0000-00000000000c', 'Molar pregnancy', false, 3);

-- Q13 (Neonatology, single, easy)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-00000000000d', 'a4000000-0000-0000-0000-000000000001', 'mcq_single', 'easy',
 'At 1 minute of life a term newborn has a heart rate of 120, cries vigorously, has active movement, grimaces to suction and has a pink body with blue extremities. What is the APGAR score?',
 'Score each of the five components: heart rate >100 = 2, vigorous cry (respiratory effort) = 2, active movement (tone) = 2, grimace to suction (reflex irritability) = 1, and acrocyanosis — pink body with blue extremities — = 1. Total = 8.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-00000000000d', '8', true, 0),
('c0000000-0000-0000-0000-00000000000d', '10', false, 1),
('c0000000-0000-0000-0000-00000000000d', '6', false, 2),
('c0000000-0000-0000-0000-00000000000d', '5', false, 3);

-- Q14 (Neonatology, single, hard)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-00000000000e', 'a4000000-0000-0000-0000-000000000001', 'mcq_single', 'hard',
 'A term baby develops jaundice within the first 24 hours of life. Which underlying process should be excluded most urgently?',
 'Jaundice within the first 24 hours is always pathological and haemolysis (e.g. ABO or Rhesus incompatibility, G6PD deficiency) must be excluded urgently, as unconjugated bilirubin can rise rapidly and cause kernicterus. Physiological jaundice never appears in the first 24 hours.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-00000000000e', 'Haemolytic disease of the newborn', true, 0),
('c0000000-0000-0000-0000-00000000000e', 'Physiological jaundice', false, 1),
('c0000000-0000-0000-0000-00000000000e', 'Breast-milk jaundice', false, 2),
('c0000000-0000-0000-0000-00000000000e', 'Gilbert syndrome', false, 3);

-- Q15 (Paediatric ID, single, medium)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-00000000000f', 'a4000000-0000-0000-0000-000000000002', 'mcq_single', 'medium',
 'A 3-year-old presents with a barking cough, inspiratory stridor and hoarseness that is worse at night, with a low-grade fever. The child is not drooling and looks well between coughing fits. What is the most appropriate initial treatment?',
 'The picture is croup (viral laryngotracheobronchitis). A single dose of oral dexamethasone is the mainstay of treatment for all severities. Nebulised adrenaline is added for severe/stridor at rest. Antibiotics are not indicated in this viral illness.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-00000000000f', 'Oral dexamethasone', true, 0),
('c0000000-0000-0000-0000-00000000000f', 'Intravenous ceftriaxone', false, 1),
('c0000000-0000-0000-0000-00000000000f', 'Nebulised salbutamol', false, 2),
('c0000000-0000-0000-0000-00000000000f', 'Oral amoxicillin', false, 3);

-- Q16 (Cardiology, single, hard)
insert into questions (id, topic_id, type, difficulty, stem, explanation, is_published) values
('c0000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000001', 'mcq_single', 'hard',
 'A 72-year-old with palpitations has an irregularly irregular pulse. ECG confirms atrial fibrillation. He has hypertension and diabetes. Using CHA2DS2-VASc, what is the most appropriate long-term therapy to reduce stroke risk?',
 'His CHA2DS2-VASc score is at least 3 (hypertension 1, diabetes 1, age 65-74 1). A score >=2 in men warrants oral anticoagulation; a DOAC is preferred over aspirin, which is no longer recommended for stroke prevention in AF.',
 true);
insert into question_options (question_id, label, is_correct, position) values
('c0000000-0000-0000-0000-000000000010', 'Direct oral anticoagulant', true, 0),
('c0000000-0000-0000-0000-000000000010', 'Aspirin 75 mg daily', false, 1),
('c0000000-0000-0000-0000-000000000010', 'No antithrombotic therapy', false, 2),
('c0000000-0000-0000-0000-000000000010', 'Clopidogrel monotherapy', false, 3);

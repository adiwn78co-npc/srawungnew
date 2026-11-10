import type {
  Program,
  Outcome,
  Output,
  Activity,
  SubActivity,
  Tor,
  TorApprovalRecord,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  OutputRaciRecord,
  ActivityMonitoringRecord,
  MonitoringReportItem,
  MasterParticipantRecord,
} from '../types/index.ts';

export const SEED_PROGRAMS: Program[] = [
  {
    id: 'prog-wijna-01',
    name: 'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    code: 'PRJ3581',
    location: 'Kabupaten Demak, Kabupaten Pekalongan & Kota Semarang, Jawa Tengah',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    description:
      'Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia (1 April 2026 – 31 Maret 2027).',
    folderUrl: 'https://drive.google.com/drive/folders/wijna-prj3581-2026',
    picId: '',
    picName: '',
    status: 'Aktif',
    createdAt: '2026-04-01T08:00:00Z',
    updatedAt: '2026-10-15T10:30:00Z',
  },
];

export const SEED_OUTCOMES: Outcome[] = [
  {
    id: 'outc-srw-1',
    programId: 'prog-wijna-01',
    programName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    outcomeNumber: 'Outcome 1',
    name: 'Outcome 1: WIJNA has increased its organization structure, Governance and Operational Capacity.',
    description:
      'WIJNA has increased its organization structure, Governance and Operational Capacity.',
    picId: '',
    picName: '',
    projectName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outc-srw-1a',
        name: 'WIJNA has expanded its organizational structure and strengthened its governance through clearer roles, updated policies, and increased board engagement.',
        description:
          'WIJNA board minutes, board resolutions/memoranda, approved institutional policies, and strategic planning documents and organizational sustainability strategy.',
        dataSource:
          'WIJNA board minutes, board resolutions/memoranda, approved institutional policies, and strategic planning documents and organizational sustainability strategy.',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          "1 board minutes & 1 board resolution each year ; 10 policies by the end of project ; 6 board member (3 M & 3 F) ; 6 Wijna's staff (3M & 3F)",
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          'WIJNA has strengthened its organizational governance and developed robust policies to support its sustainability goals. The board has demonstrated strong engagement in enhancing WIJNA\'s capacity, building its independence, and identifying opportunities to access additional funding to ensure sustainability."',
        endOfProjectGoal:
          'WIJNA has strengthened its organizational governance and developed robust policies to support its sustainability goals. The board has demonstrated strong engagement in enhancing WIJNA\'s capacity, building its independence, and identifying opportunities to access additional funding to ensure sustainability."',
        unit: 'Dokumen & Kebijakan',
        verificationMethod:
          'WIJNA board minutes, board resolutions/memoranda, approved institutional policies, and strategic planning documents and organizational sustainability strategy.',
      },
    ],
    createdAt: '2026-01-08T08:00:00Z',
  },
  {
    id: 'outc-srw-2',
    programId: 'prog-wijna-01',
    programName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    outcomeNumber: 'Outcome 2',
    name: 'Outcome 2: WIJNA has increased its capacity to access grants beyond MCC',
    description: 'WIJNA has increased its capacity to access grants beyond MCC',
    picId: '',
    picName: '',
    projectName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outc-srw-2a',
        name: '# of staff trained in grant writing and donor compliance.',
        description: 'Training certificate, and pre and post test, training reports',
        dataSource: 'Training certificate, and pre and post test, training reports',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '3 staff (2M 1F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: '3 staffs trained in grant writing and donor compliance.',
        endOfProjectGoal: '3 staffs trained in grant writing and donor compliance.',
        unit: 'Staff',
        verificationMethod: 'Training certificate, and pre and post test, training reports',
      },
      {
        id: 'ind-outc-srw-2b',
        name: '# of new donor engagements or partnerships established.',
        description: 'Partnership agreement, colaboration agreement',
        dataSource: 'Partnership agreement, colaboration agreement',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '3 new donors or partners by WIJNA staff (2M 3F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: 'at least 3 new donor engagements or partnerships established.',
        endOfProjectGoal: 'at least 3 new donor engagements or partnerships established.',
        unit: 'Partnerships',
        verificationMethod: 'Partnership agreement, colaboration agreement',
      },
      {
        id: 'ind-outc-srw-2c',
        name: '# of grant proposals submitted to non-MCC donors.',
        description: 'Proposal submited',
        dataSource: 'Proposal submited',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '2 grant proposal by WIJNA staff (2M 3F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: 'at least 2 grant proposals submitted to non-MCC donors.',
        endOfProjectGoal: 'at least 2 grant proposals submitted to non-MCC donors.',
        unit: 'Proposals',
        verificationMethod: 'Proposal submited',
      },
      {
        id: 'ind-outc-srw-2d',
        name: '# of successful grants awarded from new funding sources.',
        description: 'Award letter, and project contract',
        dataSource: 'Award letter, and project contract',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '2 awards',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: 'at least 2 successful grants awarded from new funding sources.',
        endOfProjectGoal: 'at least 2 successful grants awarded from new funding sources.',
        unit: 'Awards',
        verificationMethod: 'Award letter, and project contract',
      },
    ],
    createdAt: '2026-01-09T08:00:00Z',
  },
  {
    id: 'outc-srw-3',
    programId: 'prog-wijna-01',
    programName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    outcomeNumber: 'Outcome 3',
    name: 'Outcome 3: Enhanced accompaniment and technical support delivered to implementing partners in Indonesia to strengthen program quality and effectiveness.',
    description:
      'Enhanced accompaniment and technical support delivered to implementing partners in Indonesia to strengthen program quality and effectiveness.',
    picId: '',
    picName: '',
    projectName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outc-srw-3a',
        name: '# of accompaniment and technical support sessions conducted with implementing partners.',
        description: 'Technical support report, attendance',
        dataSource: 'Technical support report, attendance',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          'at least 20 accompaniment and technical support sessions conducted with implementing partners each year',
        endOfProjectGoal:
          'at least 20 accompaniment and technical support sessions conducted with implementing partners each year',
        unit: 'Sessions',
        verificationMethod: 'Technical support report, attendance',
      },
      {
        id: 'ind-outc-srw-3b',
        name: '% of implementing partners reporting improved capacity due to accompaniment support.',
        description: 'Partner feedback form, and partner implementation performance',
        dataSource: 'Partner feedback form, and partner implementation performance',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          'at least 90% of implementing partners reporting improved capacity due to accompaniment support.',
        endOfProjectGoal:
          'at least 90% of implementing partners reporting improved capacity due to accompaniment support.',
        unit: 'Persen (%)',
        verificationMethod: 'Partner feedback form, and partner implementation performance',
      },
      {
        id: 'ind-outc-srw-3c',
        name: '% of implementing partners meeting MCC program quality standards after receiving support.',
        description: 'MCC feedback to implementing partner',
        dataSource: 'MCC feedback to implementing partner',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          'at least 90% of implementing partners meeting MCC program quality standards after receiving support.',
        endOfProjectGoal:
          'at least 90% of implementing partners meeting MCC program quality standards after receiving support.',
        unit: 'Persen (%)',
        verificationMethod: 'MCC feedback to implementing partner',
      },
    ],
    createdAt: '2026-01-09T09:00:00Z',
  },
  {
    id: 'outc-srw-4',
    programId: 'prog-wijna-01',
    programName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    outcomeNumber: 'Outcome 4',
    name: 'Outcome 4: Improved implementation quality and impact of Global Service Learning (GSL) Program co-implemented by WIJNA and MCC',
    description:
      'Improved implementation quality and impact of Global Service Learning (GSL) Program co-implemented by WIJNA and MCC',
    picId: '',
    picName: '',
    projectName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outc-srw-4a',
        name: '% of participants reporting a meaningful experience as GSL participants serving in Indonesia.',
        description: 'Participant feedback form and reflection document',
        dataSource: 'Participant feedback form and reflection document',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '24 GSL participant (12 sent and 12 recived) (12 M 12F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          '100 % of participants reporting a meaningful experience as GSL participants serving in Indonesia.',
        endOfProjectGoal:
          '100 % of participants reporting a meaningful experience as GSL participants serving in Indonesia.',
        unit: 'Persen (%)',
        verificationMethod: 'Participant feedback form and reflection document',
      },
      {
        id: 'ind-outc-srw-4b',
        name: '# of Indonesian participants successfully recruited into the GSL Program and placed in other countries.',
        description: 'Official placement document or official invitation from MCC (Signed ROA)',
        dataSource: 'Official placement document or official invitation from MCC (Signed ROA)',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '12 GSL participants (6M 6F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          '12 Indonesian participants successfully recruited into the GSL Program and placed in other countries.',
        endOfProjectGoal:
          '12 Indonesian participants successfully recruited into the GSL Program and placed in other countries.',
        unit: 'Participants',
        verificationMethod:
          'Official placement document or official invitation from MCC (Signed ROA)',
      },
    ],
    createdAt: '2026-01-09T10:00:00Z',
  },
  {
    id: 'outc-srw-5',
    programId: 'prog-wijna-01',
    programName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    outcomeNumber: 'Outcome 5',
    name: 'Outcome 5: Improve strategic engagement between MCC and Mennonite and Papua Synod',
    description: 'Improve strategic engagement between MCC and Mennonite and Papua Synod',
    picId: '',
    picName: '',
    projectName:
      'PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outc-srw-5a',
        name: '# of meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods',
        description: 'Activity report, attendance, documentation',
        dataSource: 'Activity report, attendance, documentation',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '2 MCC representatives (male and female), 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female), 6 persons from Synods (3 male & 3 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          '6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods',
        endOfProjectGoal:
          '6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods',
        unit: 'Sessions',
        verificationMethod: 'Activity report, attendance, documentation',
      },
    ],
    createdAt: '2026-01-09T11:00:00Z',
  },
];

export const SEED_OUTPUTS: Output[] = [
  {
    id: 'outp-srw-1-1',
    outcomeId: 'outc-srw-1',
    outputNumber: 'Output 1.1',
    name: 'Output 1.1: Conduct regular board meeting',
    description: 'Conduct regular board meeting',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-1-1a',
        name: '# of regular Board meetings conducted according to the approved governance schedule',
        description: 'Board minutes and attendance',
        dataSource: 'Board minutes and attendance',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown:
          "3 Board' minutes and 3 attendance list ; 6 board member (3 M & 3 F) ; 6 Wijna's staff (3M & 3F)",
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          'Three board meetings are conducted over the project period, at a rate of one per year from 2026 to 2028.',
        endOfProjectGoal:
          'Three board meetings are conducted over the project period, at a rate of one per year from 2026 to 2028.',
        unit: 'Meetings',
        verificationMethod: 'Board minutes and attendance',
      },
    ],
    createdAt: '2026-01-10T08:00:00Z',
  },
  {
    id: 'outp-srw-1-2',
    outcomeId: 'outc-srw-1',
    outputNumber: 'Output 1.2',
    name: 'Output 1.2: Organizational policies are developed, updated, and approved by the Board.',
    description: 'Organizational policies are developed, updated, and approved by the Board.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-1-2a',
        name: '% of organizational policies developed/updated and approved by the Board.',
        description: 'Policies develop, improved and approved by the Board',
        dataSource: 'Policies develop, improved and approved by the Board',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '10 policies by the end of project',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          '100% of the organizational policies prioritized in the project are developed/updated and formally approved by the Board by the end of the project.',
        endOfProjectGoal:
          '100% of the organizational policies prioritized in the project are developed/updated and formally approved by the Board by the end of the project.',
        unit: 'Persen (%)',
        verificationMethod: 'Policies develop, improved and approved by the Board',
      },
    ],
    createdAt: '2026-01-10T09:00:00Z',
  },
  {
    id: 'outp-srw-1-3',
    outcomeId: 'outc-srw-1',
    outputNumber: 'Output 1.3',
    name: 'Output 1.3: Key staff positions are filled with qualified and competent personnel, with staff retention maintained.',
    description:
      'Key staff positions are filled with qualified and competent personnel, with staff retention maintained.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-1-3a',
        name: '% of key staff positions filled; retention rate at 90%.',
        description: 'Staff JD, and contract, updated organizational chart',
        dataSource: 'Staff JD, and contract, updated organizational chart',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '6 WIJNA staff (3M 3F) & the 3rd year recruited 2 new staffs (1M 1F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          '100% key staff positions are filled with qualified and competent personnel, and overall staff retention is maintained at least 90%',
        endOfProjectGoal:
          '100% key staff positions are filled with qualified and competent personnel, and overall staff retention is maintained at least 90%',
        unit: 'Persen (%)',
        verificationMethod: 'Staff JD, and contract, updated organizational chart',
      },
    ],
    createdAt: '2026-01-10T09:30:00Z',
  },
  {
    id: 'outp-srw-1-4',
    outcomeId: 'outc-srw-1',
    outputNumber: 'Output 1.4',
    name: 'Output 1.4: Staff receive development training that enhances their skills and improves overall institutional effectiveness.',
    description:
      'Staff receive development training that enhances their skills and improves overall institutional effectiveness.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-1-4a',
        name: '% of staff who complete development training aligned with institutional capacity needs.',
        description: 'Training certificate, and pre and post test, training reports',
        dataSource: 'Training certificate, and pre and post test, training reports',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '3 staff (2M 1F)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          'at least 80% of staff have completed development training that is aligned with institutional capacity needs.',
        endOfProjectGoal:
          'at least 80% of staff have completed development training that is aligned with institutional capacity needs.',
        unit: 'Persen (%)',
        verificationMethod: 'Training certificate, and pre and post test, training reports',
      },
    ],
    createdAt: '2026-01-10T10:00:00Z',
  },
  {
    id: 'outp-srw-2-1',
    outcomeId: 'outc-srw-2',
    outputNumber: 'Output 2.1',
    name: 'Output 2.1: Donor networking activities strengthened to expand engagement and partnership opportunities.',
    description:
      'Donor networking activities strengthened to expand engagement and partnership opportunities.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-2-1a',
        name: '# of new or strengthened donor relationships established through networking activities.',
        description: 'Activity report',
        dataSource: 'Activity report',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '3 new donors or partners by WIJNA staff (2M 3F)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          'at least 3 new or strengthened donor relationships have been established through WIJNA’s networking activities.',
        endOfProjectGoal:
          'at least 3 new or strengthened donor relationships have been established through WIJNA’s networking activities.',
        unit: 'Donor Relationships',
        verificationMethod: 'Activity report',
      },
    ],
    createdAt: '2026-01-11T08:00:00Z',
  },
  {
    id: 'outp-srw-2-2',
    outcomeId: 'outc-srw-2',
    outputNumber: 'Output 2.2',
    name: 'Output 2.2: Relevant WIJNA staff trained in grants management and proposal development.',
    description: 'Relevant WIJNA staff trained in grants management and proposal development.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-2-2a',
        name: '# of WIJNA staff who completed training in grants management and proposal development.',
        description: 'Training certificate, and pre and post test, training reports',
        dataSource: 'Training certificate, and pre and post test, training reports',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '3 staff (2M 1F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target:
          '3 WIJNA staff who completed training in grants management and proposal development.',
        endOfProjectGoal:
          '3 WIJNA staff who completed training in grants management and proposal development.',
        unit: 'Staff',
        verificationMethod: 'Training certificate, and pre and post test, training reports',
      },
    ],
    createdAt: '2026-01-11T08:30:00Z',
  },
  {
    id: 'outp-srw-2-3',
    outcomeId: 'outc-srw-2',
    outputNumber: 'Output 2.3',
    name: 'Output 2.3: Project proposals are developed and submitted to potential funding sources.',
    description: 'Project proposals are developed and submitted to potential funding sources.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-2-3a',
        name: '# of project proposals developed and submitted to potential funding sources',
        description: 'Proposal submited',
        dataSource: 'Proposal submited',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '2 project proposal by WIJNA staff (2M 3F)',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: '2 project proposals developed and submitted to potential funding sources',
        endOfProjectGoal:
          '2 project proposals developed and submitted to potential funding sources',
        unit: 'Project Proposals',
        verificationMethod: 'Proposal submited',
      },
    ],
    createdAt: '2026-01-11T09:00:00Z',
  },
  {
    id: 'outp-srw-3-1',
    outcomeId: 'outc-srw-3',
    outputNumber: 'Output 3.1',
    name: 'Output 3.1: Partner assessments conducted to evaluate appropriateness, capacity, safeguarding, and financial alignment with MCC standards.',
    description:
      'Partner assessments conducted to evaluate appropriateness, capacity, safeguarding, and financial alignment with MCC standards.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-3-1a',
        name: '# of partner assessments completed according to MCC standards.',
        description: 'Actual partner assessments',
        dataSource: 'Actual partner assessments',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '2 partner assesment ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: '2 partner assessments completed according to MCC standards.',
        endOfProjectGoal: '2 partner assessments completed according to MCC standards.',
        unit: 'Assessments',
        verificationMethod: 'Actual partner assessments',
      },
    ],
    createdAt: '2026-01-12T08:00:00Z',
  },
  {
    id: 'outp-srw-3-2',
    outcomeId: 'outc-srw-3',
    outputNumber: 'Output 3.2',
    name: 'Output 3.2: Partners receive technical support in project planning, implementation, reporting, and monitoring to ensure quality and effectiveness.',
    description:
      'Partners receive technical support in project planning, implementation, reporting, and monitoring to ensure quality and effectiveness.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-3-2a',
        name: '# of partners receiving technical support in project planning, implementation, reporting, or monitoring.',
        description:
          'Improve report, proposal, CN development, submited human intrest stories, and quality documentation',
        dataSource:
          'Improve report, proposal, CN development, submited human intrest stories, and quality documentation',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '2 partner ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          '2 partners receiving technical support in project planning, implementation, reporting, or monitoring.',
        endOfProjectGoal:
          '2 partners receiving technical support in project planning, implementation, reporting, or monitoring.',
        unit: 'Partners',
        verificationMethod:
          'Improve report, proposal, CN development, submited human intrest stories, and quality documentation',
      },
    ],
    createdAt: '2026-01-12T08:30:00Z',
  },
  {
    id: 'outp-srw-3-3',
    outcomeId: 'outc-srw-3',
    outputNumber: 'Output 3.3',
    name: "Output 3.3: Conduct orientations and training to strengthen partners' capacity for compliance with MCC standards and guidance.",
    description:
      "Conduct orientations and training to strengthen partners' capacity for compliance with MCC standards and guidance.",
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-3-3a',
        name: '# of partners receiving orientations and trainings on MCC standards and guidance.',
        description: 'Training report, attendance',
        dataSource: 'Training report, attendance',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '2 partner ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          '2 partners receiving orientations and trainings on MCC standards and guidance.',
        endOfProjectGoal:
          '2 partners receiving orientations and trainings on MCC standards and guidance.',
        unit: 'Partners',
        verificationMethod: 'Training report, attendance',
      },
    ],
    createdAt: '2026-01-12T09:00:00Z',
  },
  {
    id: 'outp-srw-3-4',
    outcomeId: 'outc-srw-3',
    outputNumber: 'Output 3.4',
    name: "Output 3.4: Partners' peacebuilding skills and knowledge enhanced through MPI participation.",
    description:
      "Partners' peacebuilding skills and knowledge enhanced through MPI participation.",
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-3-4a',
        name: '# of partners participating in the Mindanao Peacebuilding Institute (MPI)',
        description: 'Training completion certificate from MPI, participant reflection',
        dataSource: 'Training completion certificate from MPI, participant reflection',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '2 person (1M ; 1F)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          "at least 2 person from WIJNA's partners participating in the Mindanao Peacebuilding Institute (MPI) each year",
        endOfProjectGoal:
          "at least 2 person from WIJNA's partners participating in the Mindanao Peacebuilding Institute (MPI) each year",
        unit: 'Persons',
        verificationMethod: 'Training completion certificate from MPI, participant reflection',
      },
    ],
    createdAt: '2026-01-12T09:30:00Z',
  },
  {
    id: 'outp-srw-3-5',
    outcomeId: 'outc-srw-3',
    outputNumber: 'Output 3.5',
    name: 'Output 3.5: Annual partner gatherings and learning events conducted to foster collaboration and knowledge exchange',
    description:
      'Annual partner gatherings and learning events conducted to foster collaboration and knowledge exchange',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-3-5a',
        name: '# of partner gatherings and learning events conducted annually.',
        description: 'Activity Report and documentation',
        dataSource: 'Activity Report and documentation',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '20 staff of partners (10 female and 10 male), 2 Wijna Board members (1 male and 1 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: '1 time partner gatherings and learning events conducted annually.',
        endOfProjectGoal: '1 time partner gatherings and learning events conducted annually.',
        unit: 'Events',
        verificationMethod: 'Activity Report and documentation',
      },
    ],
    createdAt: '2026-01-12T10:00:00Z',
  },
  {
    id: 'outp-srw-3-6',
    outcomeId: 'outc-srw-3',
    outputNumber: 'Output 3.6',
    name: 'Output 3.6: Regular monitoring and evaluation activities conducted to track project progress and outcomes (baseline and endline)',
    description:
      'Regular monitoring and evaluation activities conducted to track project progress and outcomes (baseline and endline)',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-3-6a',
        name: '# of monitoring and evaluation activities conducted',
        description: 'Monitoring and evalution report, baseline report',
        dataSource: 'Monitoring and evalution report, baseline report',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '2 partner ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: 'at least 20 monitoring and evaluation activities conducted annualy',
        endOfProjectGoal: 'at least 20 monitoring and evaluation activities conducted annualy',
        unit: 'Activities',
        verificationMethod: 'Monitoring and evalution report, baseline report',
      },
    ],
    createdAt: '2026-01-12T10:30:00Z',
  },
  {
    id: 'outp-srw-4-1',
    outcomeId: 'outc-srw-4',
    outputNumber: 'Output 4.1',
    name: 'Output 4.1: Indonesian GSL participants are recruited, selected, and vetted.',
    description: 'Indonesian GSL participants are recruited, selected, and vetted.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-4-1a',
        name: '# of Indonesian participants successfully recruited, selected, and vetted.',
        description: 'Official placement document or official invitation from MCC',
        dataSource: 'Official placement document or official invitation from MCC',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '12 GSL participants (6M 6F)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: '12 Indonesian participants successfully recruited, selected, and vetted.',
        endOfProjectGoal:
          '12 Indonesian participants successfully recruited, selected, and vetted.',
        unit: 'Participants',
        verificationMethod: 'Official placement document or official invitation from MCC',
      },
    ],
    createdAt: '2026-01-13T08:00:00Z',
  },
  {
    id: 'outp-srw-4-2',
    outcomeId: 'outc-srw-4',
    outputNumber: 'Output 4.2',
    name: 'Output 4.2: Indonesian GSL participants deployed in Indonesia are supported through coordination, monitoring, and logistics.',
    description:
      'Indonesian GSL participants deployed in Indonesia are supported through coordination, monitoring, and logistics.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-4-2a',
        name: '# of participants receiving coordination, monitoring, and logistic support.',
        description: 'visa payment document, language training document, activity reports',
        dataSource: 'visa payment document, language training document, activity reports',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '12 GSL participants (6M 6F)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: '12 participants receiving coordination, monitoring, and logistic support.',
        endOfProjectGoal:
          '12 participants receiving coordination, monitoring, and logistic support.',
        unit: 'Participants',
        verificationMethod: 'visa payment document, language training document, activity reports',
      },
    ],
    createdAt: '2026-01-13T08:30:00Z',
  },
  {
    id: 'outp-srw-4-3',
    outcomeId: 'outc-srw-4',
    outputNumber: 'Output 4.3',
    name: 'Output 4.3: Placements and host families are developed and prepared to support the Indonesia GSL Program.',
    description:
      'Placements and host families are developed and prepared to support the Indonesia GSL Program.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-4-3a',
        name: '# of placements and host families developed and prepared.',
        description: 'List of placement and host families',
        dataSource: 'List of placement and host families',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown: '12 host family-household (12 male 12 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: '12 placements and 12 host families developed and prepared.',
        endOfProjectGoal: '12 placements and 12 host families developed and prepared.',
        unit: 'Placements & Host Families',
        verificationMethod: 'List of placement and host families',
      },
    ],
    createdAt: '2026-01-13T09:00:00Z',
  },
  {
    id: 'outp-srw-4-4',
    outcomeId: 'outc-srw-4',
    outputNumber: 'Output 4.4',
    name: 'Output 4.4: Related activities are conducted to support the GSL Program.',
    description: 'Related activities are conducted to support the GSL Program.',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-4-4a',
        name: '# of GSL support activities implemented.',
        description: 'Activity report, attendance',
        dataSource: 'Activity report, attendance',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '12 host family-household (12 male 12 female) 20 alumni (10 male 10 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target: '12 GSL support activities implemented.',
        endOfProjectGoal: '12 GSL support activities implemented.',
        unit: 'Activities',
        verificationMethod: 'Activity report, attendance',
      },
    ],
    createdAt: '2026-01-13T09:30:00Z',
  },
  {
    id: 'outp-srw-5-1',
    outcomeId: 'outc-srw-5',
    outputNumber: 'Output 5.1',
    name: 'Output 5.1: Strengthened engagement and relationships between MCC and the Mennonite and Papua synods through networking and coordination support',
    description:
      'Strengthened engagement and relationships between MCC and the Mennonite and Papua synods through networking and coordination support',
    picId: '',
    picName: '',
    status: 'Sedang Berjalan',
    indicators: [
      {
        id: 'ind-outp-srw-5-1a',
        name: '# of meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods',
        description: 'Activity report, attendance, documentation',
        dataSource: 'Activity report, attendance, documentation',
        cumulativeType: 'Cumulative',
        plannedDataBreakdown:
          '2 MCC representatives (male and female), 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female), 6 persons from Synods (3 male & 3 female)',
        reportingFrequency: 'Semi-annual',
        baseline: 'TBA',
        target:
          '6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods',
        endOfProjectGoal:
          '6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods',
        unit: 'Sessions',
        verificationMethod: 'Activity report, attendance, documentation',
      },
    ],
    createdAt: '2026-01-14T08:00:00Z',
  },
];

export const SEED_ACTIVITIES: Activity[] = [
  {
    id: 'act-srw-1-1-1',
    outputId: 'outp-srw-1-1',
    activityNumber: 'Activity 1.1',
    code: '1.1.1',
    name: 'Activity 1.1 Conduct regular Board meetings to ensure accountability, effective governance and decision-making.',
    description:
      'Regular board meetings will be conducted once a year. During these meetings, WIJNA will present the organization’s financial status and key accomplishments within the period. Important decisions will be made, and policies reviewed and approved. Key discussions on WIJNA’s sustainability, challenges, and opportunities will be held, and appropriate plans for execution by the WIJNA team will be developed.',
    anticipatedInputs: 'Venue, transportation, key documents, documenter',
    plannedParticipantsBreakdown:
      '6 board member (3 male and 3 female) and 6 Wijna staff (3 male and 3 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-12T08:00:00Z',
  },
  {
    id: 'act-srw-1-2-1',
    outputId: 'outp-srw-1-2',
    activityNumber: 'Activity 1.2',
    code: '1.2.1',
    name: 'Activity 1.2 Develop and update organizational policies and procedures to strengthen institutional systems and compliance.',
    description:
      'WIJNA will develop and maintain its core organizational policies and conduct periodic updates to the supporting SOPs in strategic areas such as Safeguarding & PSEAH, Data Protection & Digital Security, Anti-Fraud and Anti-Corruption, Financial Integrity, MEAL, Climate & Environmental Risk, Security & Field Safety, Partnership & Local Coordination, HR, Communication & Ethical Media, and the complaint mechanism. These SOPs will be evaluated and revised annually to ensure relevance, quality, and compliance with national regulations and best-practice standards. All approved updates will be communicated to staff to ensure consistent implementation across the organization.',
    anticipatedInputs:
      'Policy development materials, consultant or reviewer fees, staff time, software for document management, meeting facilitation, printing and dissemination costs.',
    plannedParticipantsBreakdown: '5 Wijna staff (3 female and 2 male)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-12T08:30:00Z',
  },
  {
    id: 'act-srw-1-1-2',
    outputId: 'outp-srw-1-3',
    activityNumber: 'Activity 1.3',
    code: '1.3.1',
    name: 'Activity 1.3 Recruit and retain qualified WIJNA staff to maintain organizational capacity and continuity.',
    description:
      'WIJNA will recruit two qualified staff (a Finance Officer and a Program Manager in year 3) to maintain organizational capacity as two current staff retire. A structured knowledge-transfer process will ensure continuity. Recruitment will follow transparent, competency-based standards, supported by supervision, capacity-building, and a positive work environment to retain staff.',
    anticipatedInputs:
      'Training venue, trainer or consultant fees, modules and training materials, transportation, meals, accommodation (if needed), monitoring tools.',
    plannedParticipantsBreakdown: '2 Wijna staff (1 male and 1 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-12T09:00:00Z',
  },
  {
    id: 'act-srw-1-4-1',
    outputId: 'outp-srw-1-4',
    activityNumber: 'Activity 1.4',
    code: '1.4.1',
    name: 'Activity 1.4 Conduct staff and organizational development training to enhance skills, performance, and institutional effectiveness.',
    description:
      "WIJNA will implement targeted staff and organizational development trainings to strengthen skills, address capacity gaps, and ensure compliance with best-practice standards. Priority areas include program quality, safeguarding, risk management, and operational sustainability, supporting WIJNA's effectiveness and alignment with donor expectations.",
    anticipatedInputs:
      'Travel and transportation, accommodation, networking event fees, communication materials, documentation support.',
    plannedParticipantsBreakdown: '5 Wijna staff (3 female and 2 male)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-12T09:30:00Z',
  },
  {
    id: 'act-srw-2-1-1',
    outputId: 'outp-srw-2-1',
    activityNumber: 'Activity 2.1',
    code: '2.1.1',
    name: 'Activity 2.1 Conduct networking activities with partners, donors, and relevant stakeholders to strengthen collaboration and WIJNA’s visibility.',
    description:
      'WIJNA will engage in strategic networking with partners, donors, government actors, and relevant stakeholders to strengthen collaboration, expand resource opportunities, and increase WIJNA’s visibility. These engagements will support partnerships for program delivery, coordination, and long-term sustainability.',
    anticipatedInputs:
      'Consultant fees, training venue, training materials, staff time, transportation, meals, documentation tools.',
    plannedParticipantsBreakdown:
      '5 Wijna staff (3 female and 2 male), 6 partners (2 male, 4 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-14T08:00:00Z',
  },
  {
    id: 'act-srw-2-2-1',
    outputId: 'outp-srw-2-2',
    activityNumber: 'Activity 2.2',
    code: '2.2.1',
    name: 'Activity 2.2 Conduct grants management and proposal development training for relevant WIJNA staff to enhance fundraising capacity.',
    description:
      'To build stronger institutional capacity, WIJNA will contract a qualified consultant to provide structured training in grants management and proposal development. The training will equip staff with the skills needed to meet donor standards, prepare competitive proposals, and manage awarded funds responsibly and effectively.',
    anticipatedInputs:
      'Consultant fees, training venue, training materials, staff time, transportation, meals, documentation tools.',
    plannedParticipantsBreakdown: '3 Wijna staff (1 female and 2 male)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-14T10:00:00Z',
  },
  {
    id: 'act-srw-2-3-1',
    outputId: 'outp-srw-2-3',
    activityNumber: 'Activity 2.3',
    code: '2.3.1',
    name: 'Activity 2.3 Develop and submit project proposals to potential funding sources to diversify and expand WIJNA’s resource base.',
    description:
      'WIJNA will develop and submit high-quality project proposals to diverse funding sources to expand its resource base, strengthen financial sustainability, and support the organization’s long-term program growth.',
    anticipatedInputs:
      'Consultant fees, staff time, meeting facilitation, data collection tools, communication expenses.',
    plannedParticipantsBreakdown: '3 Wijna staff (1 female and 2 male)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-14T11:00:00Z',
  },
  {
    id: 'act-srw-3-1-1',
    outputId: 'outp-srw-3-1',
    activityNumber: 'Activity 3.1',
    code: '3.1.1',
    name: "Activity 3.1 Conduct partner assessments to evaluate partners' partnership appropriateness, capacity building, safeguarding and financial capacity alignment with MCC accompaniment approach.",
    description:
      'WIJNA will conduct partner assessments to evaluate partnership suitability, organizational capacity, safeguarding practices, and financial management systems, ensuring alignment with WIJNA’s accompaniment approach and standards for responsible partnership.',
    anticipatedInputs:
      'Assessment tools and templates, transportation, accommodation, staff time, documentation materials, communication support.',
    plannedParticipantsBreakdown:
      '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-15T08:00:00Z',
  },
  {
    id: 'act-srw-3-2-1',
    outputId: 'outp-srw-3-2',
    activityNumber: 'Activity 3.2',
    code: '3.2.1',
    name: 'Activity 3.2 Provide technical support to partners in project planning, development, implementation, reporting, and monitoring to ensure quality and effectiveness.',
    description:
      'WIJNA will provide technical support to partners in project planning, development, implementation, reporting, and monitoring to strengthen program quality, enhance accountability, and ensure effective delivery of project outcomes.',
    anticipatedInputs:
      'Training and mentoring materials, facilitator time, transportation, venue (if needed), communication tools, documentation.',
    plannedParticipantsBreakdown:
      '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-15T08:30:00Z',
  },
  {
    id: 'act-srw-3-3-1',
    outputId: 'outp-srw-3-3',
    activityNumber: 'Activity 3.3',
    code: '3.3.1',
    name: 'Activity 3.3 Conduct orientations and training to strengthen partners’ capacity for compliance with MCC standards and guidance.',
    description:
      'WIJNA will conduct orientations and training to strengthen partners’ capacity to comply with MCC standards and guidance, ensuring consistent quality, accountability, and alignment across all partnership activities.',
    anticipatedInputs:
      'Training venue, learning materials, transportation, meals, monitoring and evaluation tools.',
    plannedParticipantsBreakdown:
      '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-15T09:00:00Z',
  },
  {
    id: 'act-srw-3-4-1',
    outputId: 'outp-srw-3-4',
    activityNumber: 'Activity 3.4',
    code: '3.4.1',
    name: 'Activity 3.4 Facilitate the participation of partners in the Mindanao Peacebuilding Institute (MPI) to enhance their skills and knowledge in peacebuilding.',
    description:
      'WIJNA will send strategically selected partner representatives to the Mindanao Peacebuilding Institute (MPI) to build the competencies of future key actors who will strengthen WIJNA’s long-term peacebuilding work.',
    anticipatedInputs:
      'Travel, accommodation, meals, MPI tuition fees, visa processing, insurance, coordination and documentation costs.',
    plannedParticipantsBreakdown: '7 persons (4 male and 3 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-15T09:30:00Z',
  },
  {
    id: 'act-srw-3-5-1',
    outputId: 'outp-srw-3-5',
    activityNumber: 'Activity 3.5',
    code: '3.5.1',
    name: 'Activity 3.5 Conduct annual partner gatherings and learning events to promote collaboration, reflection, and knowledge exchange.',
    description:
      'WIJNA will organize annual partner gatherings and learning events to strengthen collaboration, encourage joint reflection, and facilitate knowledge exchange that supports improved program quality and shared learning across partners.',
    anticipatedInputs:
      'Event venue, facilitation costs, transportation, meals, learning materials, documentation support.',
    plannedParticipantsBreakdown:
      '20 partners (10 female and 10 male), 2 Wijna Board members (1 male and 1 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'act-srw-3-6-1',
    outputId: 'outp-srw-3-6',
    activityNumber: 'Activity 3.6',
    code: '3.6.1',
    name: 'Activity 3.6 Conduct regular monitoring and evaluation activities to assess project progress, outcomes, and learning.',
    description:
      'WIJNA will implement a strategic monitoring and learning process that includes project inception, baseline survey, financial and progress check-ins aligned with SOP, semi-annual and annual reporting, After Action Reviews, continuous monitoring of indicators and risks, an endline survey, and final reporting. All outputs will be systematically distributed to strengthen decision-making and partner coordination.',
    anticipatedInputs:
      'Monitoring tools, data collection instruments, staff time, transportation for site visits, meeting facilitation, reporting software.',
    plannedParticipantsBreakdown:
      '6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-15T10:30:00Z',
  },
  {
    id: 'act-srw-4-1-1',
    outputId: 'outp-srw-4-1',
    activityNumber: 'Activity 4.1',
    code: '4.1.1',
    name: 'Activity 4.1 Conduct recruitment selection and vetting of GSL participants from Indonesia.',
    description:
      'WIJNA will conduct recruitment, selection, and vetting of GSL participants, ensuring suitability, safeguarding compliance, and readiness for cross-cultural placement. WIJNA will also prepare all required visa documentation to meet program and host-country requirements, ensuring strong participant readiness in line with GSL standards.',
    anticipatedInputs:
      'Recruitment materials, communication costs, Visa processing fees, staff time, documentation tools, transportation for interviews.',
    plannedParticipantsBreakdown: '12 participants deployed (6 male and 6 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-16T08:00:00Z',
  },
  {
    id: 'act-srw-4-2-1',
    outputId: 'outp-srw-4-2',
    activityNumber: 'Activity 4.2',
    code: '4.2.1',
    name: 'Activity 4.2 Conduct recruitment, coordination, monitoring and provision of logistic support to GSL Participants deployed in Indonesia',
    description:
      'WIJNA will manage the recruitment, coordination, monitoring, and logistical support of GSL participants in Indonesia, including all required visa documentation and administrative processing to ensure smooth placement and readiness.',
    anticipatedInputs:
      'Visa processing fees, administrative materials, transportation, accommodation support, monitoring tools, staff time.',
    plannedParticipantsBreakdown: '12 participants deployed (6 male and 6 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-16T08:30:00Z',
  },
  {
    id: 'act-srw-4-3-1',
    outputId: 'outp-srw-4-3',
    activityNumber: 'Activity 4.3',
    code: '4.3.1',
    name: 'Activity 4.3 Development of placement and host families to support the Indonesia GSL Program.',
    description:
      'WIJNA will conduct the identification and preparation of suitable placement sites and host families, ensuring they understand and apply safeguarding requirements in accordance with MCC standards to support the Indonesia GSL Program.',
    anticipatedInputs:
      'Transportation for site visits, safeguarding materials, host family orientation tools, staff time, documentation.',
    plannedParticipantsBreakdown: '12 host family-household (12 male 12 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-16T09:00:00Z',
  },
  {
    id: 'act-srw-4-4-1',
    outputId: 'outp-srw-4-4',
    activityNumber: 'Activity 4.4',
    code: '4.4.1',
    name: 'Activity 4.4 Conduct related activities to support the GSL Program',
    description:
      'WIJNA will conduct related activities to strengthen the GSL Program, including routine check-ins with participants and host families to ensure alignment and gather feedback for improvement. In addition, WIJNA will organize alumni gatherings activity to maintain connections.',
    anticipatedInputs:
      'Event materials, transportation for check-ins, communication costs, alumni activity facilitation, documentation tools.',
    plannedParticipantsBreakdown:
      '12 host family-household (12 male 12 female) 20 alumni (10 male 10 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-16T09:30:00Z',
  },
  {
    id: 'act-srw-5-1-1',
    outputId: 'outp-srw-5-1',
    activityNumber: 'Activity 5.1',
    code: '5.1.1',
    name: 'Activity 5.1 Conduct networking and coordination support for MCC to strengthen its engagement and relationship with the Mennonite and Papua synod:',
    description:
      'WIJNA will provide networking and coordination support for MCC to strengthen its engagement and relationship with the Mennonite and Papua synod. This includes facilitating communication, arranging strategic meetings, and supporting collaborative activities that enhance mutual understanding, partnership alignment, and long-term engagement between MCC and synod leadership.',
    anticipatedInputs:
      'Travel and transportation, meeting facilitation, communication and documentation materials, staff time, coordination tools.',
    plannedParticipantsBreakdown:
      '2 MCC representatives (male and female), 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female), 6 persons from Synods (3 male & 3 female)',
    picId: '',
    picName: '',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'Sedang Berjalan',
    createdAt: '2026-01-17T08:00:00Z',
  },
];

export const SEED_SUB_ACTIVITIES: SubActivity[] = [];

export const SEED_OUTPUT_RACI_RECORDS: Record<string, OutputRaciRecord> = {};

export const SEED_ACTIVITY_MONITORING_RECORDS: Record<string, ActivityMonitoringRecord> = {};

export const SEED_MONITORING_REPORTS: Record<string, MonitoringReportItem> = {};

export const SEED_PARTICIPANT_DATABASE: MasterParticipantRecord[] = [];

export const SEED_TORS: Tor[] = [];

export const SEED_CASH_ADVANCES: CashAdvanceRecord[] = [];

export const SEED_MEETING_MINUTES: MeetingMinutesRecord[] = [];

export const SEED_ACTIVITY_DOCUMENTATIONS: Record<string, ActivityDocumentationRecord> = {};

export const SEED_ACTIVITY_DOCUMENTATION_LIST: ActivityDocumentationRecord[] = [];

export const SEED_APPROVAL_RECORDS: TorApprovalRecord[] = [];

export const SEED_PROGRAM_BUDGETS: Record<string, any> = {};

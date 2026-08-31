export interface TextbookResource {
  contentId: string;
  title: string;
  stage: string;
  subject: string;
  grade: string;
  volume: string;
  edition: string;
  resourceYear: string;
  onlineTime: string;
  updateTime: string;
  sizeBytes: number;
  localState: 'not-downloaded' | 'downloaded';
}

export const resources: TextbookResource[] = [
  {
    contentId: '1bb3e2fe-45a1-2999-e8b4-9fc63d0929bb',
    title: '（根据2022年版课程标准修订）义务教育教科书 英语 七年级上册',
    stage: '初中', subject: '英语', grade: '七年级', volume: '上册', edition: '北师大版',
    resourceYear: '2024年度', onlineTime: '2025-09-04 17:46', updateTime: '2026-01-22 02:04',
    sizeBytes: 60_729_089, localState: 'downloaded',
  },
  {
    contentId: '331959b8-d722-eac6-5466-4bac34806136',
    title: '（根据2022年版课程标准修订）义务教育教科书 英语 七年级上册',
    stage: '初中', subject: '英语', grade: '七年级', volume: '上册', edition: '北师大版',
    resourceYear: '2025年度', onlineTime: '2026-01-19 18:21', updateTime: '2026-01-22 01:57',
    sizeBytes: 60_796_211, localState: 'not-downloaded',
  },
  {
    contentId: '0b5bb159-2176-678c-4723-19799c829011',
    title: '（根据2022年版课程标准修订）义务教育教科书 英语 七年级上册',
    stage: '初中', subject: '英语', grade: '七年级', volume: '上册', edition: '北师大版',
    resourceYear: '2026年度', onlineTime: '2026-08-13 16:17', updateTime: '2026-08-13 16:17',
    sizeBytes: 19_977_692, localState: 'not-downloaded',
  },
  {
    contentId: 'f5f519b5-7986-43df-a525-c107556d6c40',
    title: '（根据2022年版课程标准修订）义务教育教科书 英语 七年级下册',
    stage: '初中', subject: '英语', grade: '七年级', volume: '下册', edition: '北师大版',
    resourceYear: '2025年度', onlineTime: '2026-01-19 18:20', updateTime: '2026-01-22 01:58',
    sizeBytes: 61_203_042, localState: 'not-downloaded',
  },
  {
    contentId: 'e3c1a3d0-1fc9-4a5e-8bbf-a4e3c47c0680',
    title: '（根据2022年版课程标准修订）义务教育教科书 英语 七年级下册',
    stage: '初中', subject: '英语', grade: '七年级', volume: '下册', edition: '北师大版',
    resourceYear: '2026年度', onlineTime: '2026-08-13 16:21', updateTime: '2026-08-13 16:21',
    sizeBytes: 21_154_368, localState: 'not-downloaded',
  },
  {
    contentId: '8721eef5-7d1f-44be-bafc-708a9b52fcd0',
    title: '义务教育教科书 数学 七年级上册',
    stage: '初中', subject: '数学', grade: '七年级', volume: '上册', edition: '北师大版',
    resourceYear: '2024年度', onlineTime: '2025-09-05 10:12', updateTime: '2026-01-22 02:06',
    sizeBytes: 38_714_422, localState: 'downloaded',
  },
  {
    contentId: '6b3065a9-3644-45ee-8e29-7a1f2a337cf4',
    title: '义务教育教科书 数学 七年级上册',
    stage: '初中', subject: '数学', grade: '七年级', volume: '上册', edition: '北师大版',
    resourceYear: '2025年度', onlineTime: '2026-01-20 09:47', updateTime: '2026-01-22 02:03',
    sizeBytes: 38_951_740, localState: 'not-downloaded',
  },
  {
    contentId: '66a438f1-e55d-4733-8c86-43ed42e29cf3',
    title: '义务教育教科书 语文 八年级上册',
    stage: '初中', subject: '语文', grade: '八年级', volume: '上册', edition: '人教版',
    resourceYear: '2024年度', onlineTime: '2025-09-03 16:04', updateTime: '2026-01-22 02:10',
    sizeBytes: 43_642_110, localState: 'not-downloaded',
  },
  {
    contentId: '2b9d7b64-e0c4-4a5e-8a5a-f6f19a45f97f',
    title: '义务教育教科书 语文 八年级上册',
    stage: '初中', subject: '语文', grade: '八年级', volume: '上册', edition: '人教版',
    resourceYear: '2025年度', onlineTime: '2026-01-20 10:08', updateTime: '2026-01-22 02:11',
    sizeBytes: 43_885_902, localState: 'not-downloaded',
  },
  {
    contentId: 'a90fd530-9dcc-4f43-ae78-7ae6c4b09b66',
    title: '义务教育教科书 物理 八年级上册',
    stage: '初中', subject: '物理', grade: '八年级', volume: '上册', edition: '人教版',
    resourceYear: '2025年度', onlineTime: '2026-01-20 10:25', updateTime: '2026-01-22 02:15',
    sizeBytes: 31_552_804, localState: 'not-downloaded',
  },
  {
    contentId: 'cc47f249-a53b-4f82-a5cb-332dc45db6fb',
    title: '义务教育教科书 物理 八年级上册',
    stage: '初中', subject: '物理', grade: '八年级', volume: '上册', edition: '人教版',
    resourceYear: '2026年度', onlineTime: '2026-08-13 16:34', updateTime: '2026-08-13 16:34',
    sizeBytes: 17_814_730, localState: 'not-downloaded',
  },
  {
    contentId: 'efc5cf5b-81a4-4bf4-8b2a-7aee143c82de',
    title: '义务教育教科书 化学 九年级上册',
    stage: '初中', subject: '化学', grade: '九年级', volume: '上册', edition: '人教版',
    resourceYear: '2026年度', onlineTime: '2026-08-13 16:45', updateTime: '2026-08-13 16:45',
    sizeBytes: 29_182_146, localState: 'not-downloaded',
  },
];

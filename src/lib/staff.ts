import type { DirectoryUser, ManagedUser } from './types';

// Сотрудники отдела разработки — 40 человек в четырёх отделениях.
// Хранятся в базе как пользователи (Администрирование → Пользователи); здесь — начальное заполнение.
// Входят через Windows-логин; вход по паролю — только у демонстрационных учётных записей.

export const STAFF_USERS: ManagedUser[] = [
  { employeeId: 101, fullName: 'Абрамов Олег Витальевич', position: 'Начальник отделения', email: 'abramov.ov@example.com', windowsLogin: 'abramov.ov', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 102, fullName: 'Белова Наталья Андреевна', position: 'Ведущий программист', email: 'belova.na@example.com', windowsLogin: 'belova.na', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 103, fullName: 'Воронцов Павел Игоревич', position: 'Программист', email: 'vorontsov.pi@example.com', windowsLogin: 'vorontsov.pi', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 104, fullName: 'Григорьева Елена Сергеевна', position: 'Программист', email: 'grigoreva.es@example.com', windowsLogin: 'grigoreva.es', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 105, fullName: 'Дмитриев Артём Николаевич', position: 'Программист 1 категории', email: 'dmitriev.an@example.com', windowsLogin: 'dmitriev.an', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 106, fullName: 'Ершова Ксения Владимировна', position: 'Программист 2 категории', email: 'ershova.kv@example.com', windowsLogin: 'ershova.kv', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 107, fullName: 'Жуков Максим Олегович', position: 'Инженер-программист', email: 'zhukov.mo@example.com', windowsLogin: 'zhukov.mo', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 108, fullName: 'Зуева Анастасия Павловна', position: 'Инженер-программист', email: 'zueva.ap@example.com', windowsLogin: 'zueva.ap', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 109, fullName: 'Исаев Руслан Тимурович', position: 'Разработчик', email: 'isaev.rt@example.com', windowsLogin: 'isaev.rt', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 110, fullName: 'Карпова Ирина Алексеевна', position: 'Разработчик', email: 'karpova.ia@example.com', windowsLogin: 'karpova.ia', role: 'executor', active: true, unitId: 's-dev' },
  { employeeId: 111, fullName: 'Лаптев Сергей Юрьевич', position: 'Начальник отделения', email: 'laptev.sy@example.com', windowsLogin: 'laptev.sy', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 112, fullName: 'Мельникова Дарья Игоревна', position: 'Ведущий инженер', email: 'melnikova.di@example.com', windowsLogin: 'melnikova.di', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 113, fullName: 'Никитин Владислав Андреевич', position: 'Инженер', email: 'nikitin.va@example.com', windowsLogin: 'nikitin.va', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 114, fullName: 'Осипова Татьяна Михайловна', position: 'Инженер', email: 'osipova.tm@example.com', windowsLogin: 'osipova.tm', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 115, fullName: 'Панов Евгений Сергеевич', position: 'Инженер 1 категории', email: 'panov.es@example.com', windowsLogin: 'panov.es', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 116, fullName: 'Родионова Юлия Викторовна', position: 'Инженер 2 категории', email: 'rodionova.yv@example.com', windowsLogin: 'rodionova.yv', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 117, fullName: 'Савельев Илья Константинович', position: 'Специалист', email: 'savelev.ik@example.com', windowsLogin: 'savelev.ik', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 118, fullName: 'Тихонова Марина Олеговна', position: 'Специалист', email: 'tikhonova.mo@example.com', windowsLogin: 'tikhonova.mo', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 119, fullName: 'Устинов Григорий Петрович', position: 'Системный администратор', email: 'ustinov.gp@example.com', windowsLogin: 'ustinov.gp', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 120, fullName: 'Фомина Алёна Дмитриевна', position: 'Системный администратор', email: 'fomina.ad@example.com', windowsLogin: 'fomina.ad', role: 'executor', active: true, unitId: 's-support' },
  { employeeId: 121, fullName: 'Харитонов Кирилл Романович', position: 'Начальник отделения', email: 'kharitonov.kr@example.com', windowsLogin: 'kharitonov.kr', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 122, fullName: 'Цветкова Вера Николаевна', position: 'Ведущий аналитик', email: 'tsvetkova.vn@example.com', windowsLogin: 'tsvetkova.vn', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 123, fullName: 'Чернов Денис Александрович', position: 'Аналитик', email: 'chernov.da@example.com', windowsLogin: 'chernov.da', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 124, fullName: 'Шестакова Полина Евгеньевна', position: 'Аналитик', email: 'shestakova.pe@example.com', windowsLogin: 'shestakova.pe', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 125, fullName: 'Щербаков Антон Васильевич', position: 'Аналитик 1 категории', email: 'shcherbakov.av@example.com', windowsLogin: 'shcherbakov.av', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 126, fullName: 'Юдина Светлана Игоревна', position: 'Бизнес-аналитик', email: 'yudina.si@example.com', windowsLogin: 'yudina.si', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 127, fullName: 'Яшин Георгий Андреевич', position: 'Системный аналитик', email: 'yashin.ga@example.com', windowsLogin: 'yashin.ga', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 128, fullName: 'Афанасьева Людмила Петровна', position: 'Системный аналитик', email: 'afanaseva.lp@example.com', windowsLogin: 'afanaseva.lp', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 129, fullName: 'Борисов Никита Сергеевич', position: 'Специалист по данным', email: 'borisov.ns@example.com', windowsLogin: 'borisov.ns', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 130, fullName: 'Власова Олеся Александровна', position: 'Специалист по данным', email: 'vlasova.oa@example.com', windowsLogin: 'vlasova.oa', role: 'executor', active: true, unitId: 's-analytics' },
  { employeeId: 131, fullName: 'Горбунов Вадим Олегович', position: 'Начальник отделения', email: 'gorbunov.vo@example.com', windowsLogin: 'gorbunov.vo', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 132, fullName: 'Давыдова Екатерина Юрьевна', position: 'Ведущий тестировщик', email: 'davydova.ey@example.com', windowsLogin: 'davydova.ey', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 133, fullName: 'Ефимов Станислав Игоревич', position: 'Тестировщик', email: 'efimov.si@example.com', windowsLogin: 'efimov.si', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 134, fullName: 'Журавлёва Анна Викторовна', position: 'Тестировщик', email: 'zhuravleva.av@example.com', windowsLogin: 'zhuravleva.av', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 135, fullName: 'Захаров Тимофей Денисович', position: 'Тестировщик 1 категории', email: 'zakharov.td@example.com', windowsLogin: 'zakharov.td', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 136, fullName: 'Ильина Софья Андреевна', position: 'Тестировщик 2 категории', email: 'ilina.sa@example.com', windowsLogin: 'ilina.sa', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 137, fullName: 'Королёв Михаил Павлович', position: 'Инженер по тестированию', email: 'korolev.mp@example.com', windowsLogin: 'korolev.mp', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 138, fullName: 'Лукина Валерия Сергеевна', position: 'Инженер по тестированию', email: 'lukina.vs@example.com', windowsLogin: 'lukina.vs', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 139, fullName: 'Морозов Фёдор Николаевич', position: 'Специалист', email: 'morozov.fn@example.com', windowsLogin: 'morozov.fn', role: 'executor', active: true, unitId: 's-qa' },
  { employeeId: 140, fullName: 'Назарова Алина Романовна', position: 'Специалист', email: 'nazarova.ar@example.com', windowsLogin: 'nazarova.ar', role: 'executor', active: true, unitId: 's-qa' },
];

/**
 * Демонстрационный каталог Active Directory: сотрудники, которых ещё нет среди пользователей.
 * Используется, когда сервер не подключён к домену, — чтобы можно было попробовать «Добавить пользователя».
 */
export const DEMO_DIRECTORY: DirectoryUser[] = [
  { fullName: 'Кудрявцев Олег Игоревич', surname: 'Кудрявцев', givenName: 'Олег', patronymic: 'Игоревич', login: 'kudryavtsev.oi', email: 'kudryavtsev.oi@example.com', position: 'Инженер' },
  { fullName: 'Субботина Мария Сергеевна', surname: 'Субботина', givenName: 'Мария', patronymic: 'Сергеевна', login: 'subbotina.ms', email: 'subbotina.ms@example.com', position: 'Аналитик' },
  { fullName: 'Рябов Андрей Николаевич', surname: 'Рябов', givenName: 'Андрей', patronymic: 'Николаевич', login: 'ryabov.an', email: 'ryabov.an@example.com', position: 'Программист' },
  { fullName: 'Тарасова Ольга Викторовна', surname: 'Тарасова', givenName: 'Ольга', patronymic: 'Викторовна', login: 'tarasova.ov', email: 'tarasova.ov@example.com', position: 'Специалист' },
  { fullName: 'Кириллов Павел Андреевич', surname: 'Кириллов', givenName: 'Павел', patronymic: 'Андреевич', login: 'kirillov.pa', email: 'kirillov.pa@example.com', position: 'Тестировщик' },
  { fullName: 'Голованова Ирина Петровна', surname: 'Голованова', givenName: 'Ирина', patronymic: 'Петровна', login: 'golovanova.ip', email: 'golovanova.ip@example.com', position: 'Документовед' },
  { fullName: 'Медведев Артём Олегович', surname: 'Медведев', givenName: 'Артём', patronymic: 'Олегович', login: 'medvedev.ao', email: 'medvedev.ao@example.com', position: 'Системный администратор' },
  { fullName: 'Соловьёва Елена Юрьевна', surname: 'Соловьёва', givenName: 'Елена', patronymic: 'Юрьевна', login: 'soloveva.eyu', email: 'soloveva.eyu@example.com', position: 'Ведущий специалист' },
];

export const searchDemoDirectory = (query: string): DirectoryUser[] => {
  const value = query.trim().toLocaleLowerCase('ru');
  if (value.length < 2) return [];
  return DEMO_DIRECTORY.filter((p) => p.surname.toLocaleLowerCase('ru').startsWith(value)).slice(0, 20);
};

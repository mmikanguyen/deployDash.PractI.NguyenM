<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/** Reads ?year=&restaurant=&meal= (digits only). */
function read_filters(): array
{
    $f = [];
    foreach (['year', 'restaurant', 'meal'] as $k) {
        $v = $_GET[$k] ?? '';
        if (is_string($v) && $v !== '' && ctype_digit($v)) {
            $f[$k] = (int) $v;
        }
    }
    return $f;
}

/**
 * Runs a query whose text contains {WHERE}. Filters are applied to alias `v` (Visits).
 * $skip lists filters that should NOT apply (e.g. 'restaurant' for cross-restaurant comparisons).
 */
function run(PDO $pdo, string $sql, array $f, array $skip = []): array
{
    $conds = [];
    $p = [];
    if (isset($f['year']) && !in_array('year', $skip, true)) {
        $conds[] = 'YEAR(v.VisitDate) = :year';
        $p[':year'] = $f['year'];
    }
    if (isset($f['restaurant']) && !in_array('restaurant', $skip, true)) {
        $conds[] = 'v.RestaurantID = :restaurant';
        $p[':restaurant'] = $f['restaurant'];
    }
    if (isset($f['meal']) && !in_array('meal', $skip, true)) {
        $conds[] = 'v.MealTypeID = :meal';
        $p[':meal'] = $f['meal'];
    }
    $where = $conds ? 'WHERE ' . implode(' AND ', $conds) : '';
    $st = $pdo->prepare(str_replace('{WHERE}', $where, $sql));
    $st->execute($p);
    return $st->fetchAll();
}

try {
    $pdo = pdo();
    $f = read_filters();

    $V = tbl('visits');
    $B = tbl('bills');
    $R = tbl('restaurants');
    $S = tbl('servers');
    $C = tbl('customers');
    $M = tbl('meal');
    $P = tbl('payment');

    $loyal = "UPPER(TRIM(c.LoyaltyMember)) IN ('Y','YES','TRUE','T','1')";

    /* ---- filter options (unfiltered) ---- */
    $filters = [
        'years' => array_column($pdo->query("SELECT DISTINCT YEAR(VisitDate) AS y FROM $V WHERE VisitDate IS NOT NULL ORDER BY y DESC")->fetchAll(), 'y'),
        'restaurants' => $pdo->query("SELECT rID AS id, RestaurantName AS name FROM $R ORDER BY RestaurantName")->fetchAll(),
        'meals' => $pdo->query("SELECT MealTypeID AS id, MealType AS name FROM $M ORDER BY MealTypeID")->fetchAll(),
    ];

    /* ---- headline numbers ---- */
    $kpis = run($pdo, "
        SELECT COUNT(DISTINCT v.VisitID)            AS visits,
               COUNT(DISTINCT v.CustomerID)         AS customers,
               COALESCE(SUM(v.PartySize), 0)        AS guests,
               AVG(v.WaitTime)                      AS avg_wait,
               COALESCE(SUM(b.FoodBill), 0)         AS food,
               COALESCE(SUM(b.AlcoholBill), 0)      AS alcohol,
               COALESCE(SUM(b.TipAmount), 0)        AS tips,
               AVG(b.FoodDiscountPercentage)        AS avg_discount
        FROM $V v LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}", $f)[0] ?? [];

    $multi = run($pdo, "
        SELECT COUNT(*) AS n FROM (
            SELECT v.CustomerID FROM $V v {WHERE}
            GROUP BY v.CustomerID HAVING COUNT(DISTINCT v.RestaurantID) > 1
        ) x", $f, ['restaurant'])[0]['n'] ?? 0;
    $kpis['multi_restaurant_customers'] = $multi;

    /* ---- per restaurant (restaurant filter ignored so they can be compared) ---- */
    $restaurants = run($pdo, "
        SELECT r.rID AS id, r.RestaurantName AS name, r.City AS city, r.State AS state,
               COUNT(DISTINCT v.VisitID)       AS visits,
               COUNT(DISTINCT v.CustomerID)    AS customers,
               COALESCE(SUM(b.FoodBill), 0)    AS food,
               COALESCE(SUM(b.AlcoholBill), 0) AS alcohol,
               COALESCE(SUM(b.TipAmount), 0)   AS tips,
               AVG(v.WaitTime)                 AS avg_wait,
               AVG(v.PartySize)                AS avg_party
        FROM $V v
        JOIN $R r ON r.rID = v.RestaurantID
        LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}
        GROUP BY r.rID, r.RestaurantName, r.City, r.State
        ORDER BY visits DESC", $f, ['restaurant']);

    /* ---- time ---- */
    $monthly = run($pdo, "
        SELECT DATE_FORMAT(v.VisitDate, '%Y-%m')  AS month,
               COUNT(DISTINCT v.VisitID)          AS visits,
               COUNT(DISTINCT v.CustomerID)       AS customers,
               COALESCE(SUM(b.FoodBill), 0)       AS food,
               COALESCE(SUM(b.AlcoholBill), 0)    AS alcohol,
               COALESCE(SUM(b.TipAmount), 0)      AS tips
        FROM $V v LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}
        GROUP BY DATE_FORMAT(v.VisitDate, '%Y-%m')
        ORDER BY month", $f);

    $weekday = run($pdo, "
        SELECT DAYOFWEEK(v.VisitDate) AS dow,
               COUNT(DISTINCT v.VisitID) AS visits,
               COALESCE(SUM(b.FoodBill), 0) + COALESCE(SUM(b.AlcoholBill), 0) AS revenue
        FROM $V v LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}
        GROUP BY DAYOFWEEK(v.VisitDate)
        ORDER BY dow", $f);

    $heat = run($pdo, "
        SELECT DAYOFWEEK(v.VisitDate) AS dow, HOUR(v.VisitTime) AS hr, COUNT(*) AS visits
        FROM $V v
        {WHERE}
        GROUP BY DAYOFWEEK(v.VisitDate), HOUR(v.VisitTime)", $f);

    /* ---- mix ---- */
    $meals = run($pdo, "
        SELECT m.MealType AS name,
               COUNT(DISTINCT v.VisitID) AS visits,
               COALESCE(SUM(b.FoodBill), 0) + COALESCE(SUM(b.AlcoholBill), 0) AS revenue
        FROM $V v
        JOIN $M m ON m.MealTypeID = v.MealTypeID
        LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}
        GROUP BY m.MealTypeID, m.MealType
        ORDER BY visits DESC", $f, ['meal']);

    $payments = run($pdo, "
        SELECT p.PaymentMethod AS name,
               COUNT(*) AS bills,
               COALESCE(SUM(b.FoodBill), 0) + COALESCE(SUM(b.AlcoholBill), 0) AS revenue,
               COALESCE(SUM(b.TipAmount), 0) AS tips
        FROM $V v
        JOIN $B b ON b.visitID = v.VisitID
        JOIN $P p ON p.PaymentTypeID = b.PaymentTypeID
        {WHERE}
        GROUP BY p.PaymentTypeID, p.PaymentMethod
        ORDER BY revenue DESC", $f);

    $party = run($pdo, "
        SELECT v.PartySize AS size, COUNT(*) AS visits
        FROM $V v
        {WHERE}
        GROUP BY v.PartySize
        ORDER BY v.PartySize", $f);

    $loyalty = run($pdo, "
        SELECT CASE WHEN $loyal THEN 'Loyalty members' ELSE 'Non-members' END AS name,
               COUNT(DISTINCT c.CustomerID)  AS customers,
               COUNT(DISTINCT v.VisitID)     AS visits,
               COALESCE(SUM(b.FoodBill), 0) + COALESCE(SUM(b.AlcoholBill), 0) AS revenue,
               COALESCE(SUM(b.TipAmount), 0) AS tips
        FROM $V v
        JOIN $C c ON c.CustomerID = v.CustomerID
        LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}
        GROUP BY CASE WHEN $loyal THEN 'Loyalty members' ELSE 'Non-members' END", $f);

    /* ---- people ---- */
    $servers = run($pdo, "
        SELECT s.EmpID AS id, s.ServerName AS name, r.RestaurantName AS restaurant,
               COUNT(DISTINCT v.VisitID)       AS visits,
               COALESCE(SUM(b.TipAmount), 0)   AS tips,
               COALESCE(SUM(b.FoodBill), 0) + COALESCE(SUM(b.AlcoholBill), 0) AS revenue
        FROM $V v
        JOIN $S s ON s.EmpID = v.ServerEmpID
        LEFT JOIN $R r ON r.rID = s.rID
        LEFT JOIN $B b ON b.visitID = v.VisitID
        {WHERE}
        GROUP BY s.EmpID, s.ServerName, r.RestaurantName
        ORDER BY tips DESC
        LIMIT 10", $f);

    echo json_encode(compact(
        'filters', 'kpis', 'restaurants', 'monthly', 'weekday', 'heat',
        'meals', 'payments', 'party', 'loyalty', 'servers'
    ), JSON_PARTIAL_OUTPUT_ON_ERROR);
} catch (Throwable $e) {
    http_response_code(500);
    $debug = env('APP_DEBUG') === '1';
    echo json_encode(['error' => $debug ? $e->getMessage() : 'The dashboard could not load data from the database. Set APP_DEBUG=1 to see details.']);
}

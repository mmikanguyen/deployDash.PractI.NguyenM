<?php
declare(strict_types=1);

/**
 * Shared setup: reads configuration, opens the Aiven MySQL connection over TLS,
 * and (optionally) protects the dashboard with HTTP basic auth.
 */

function load_dotenv(string $path): void
{
    if (!is_readable($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v, " \t\"'");
        if (getenv($k) === false) {
            putenv("$k=$v");
        }
    }
}

function env(string $key, ?string $default = null): ?string
{
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
}

load_dotenv(dirname(__DIR__) . '/.env');

/* ---------- optional password gate ---------- */
if (env('DASH_USER') && env('DASH_PASS')) {
    $u = $_SERVER['PHP_AUTH_USER'] ?? '';
    $p = $_SERVER['PHP_AUTH_PW'] ?? '';
    if (!hash_equals(env('DASH_USER'), $u) || !hash_equals(env('DASH_PASS'), $p)) {
        header('WWW-Authenticate: Basic realm="Covers dashboard"');
        http_response_code(401);
        echo 'Sign in to view the dashboard.';
        exit;
    }
}

/* ---------- table names (MySQL on Linux is case-sensitive) ---------- */
function tbl(string $key): string
{
    static $names = null;
    $names ??= [
        'visits'      => env('TBL_VISITS', 'Visits'),
        'bills'       => env('TBL_BILLS', 'Bills'),
        'restaurants' => env('TBL_RESTAURANTS', 'Restaurants'),
        'servers'     => env('TBL_SERVERS', 'Servers'),
        'customers'   => env('TBL_CUSTOMERS', 'Customers'),
        'meal'        => env('TBL_MEAL', 'Meal'),
        'payment'     => env('TBL_PAYMENT', 'Payment'),
    ];
    return '`' . str_replace('`', '', $names[$key]) . '`';
}

/* ---------- database ---------- */
function ca_file(): ?string
{
    // Option A: path to the ca.pem downloaded from the Aiven console
    $path = env('DB_SSL_CA');
    if ($path && is_readable($path)) {
        return $path;
    }
    // Option B: the PEM text itself in an env var (handy on hosts without file uploads)
    $pem = env('DB_SSL_CA_PEM');
    if ($pem) {
        $pem = str_replace('\n', "\n", $pem);
        $file = sys_get_temp_dir() . '/aiven-ca-' . md5($pem) . '.pem';
        if (!is_file($file)) {
            file_put_contents($file, $pem);
        }
        return $file;
    }
    // Option C: ca.pem sitting in the project root
    $local = dirname(__DIR__) . '/ca.pem';
    return is_readable($local) ? $local : null;
}

function pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $req) {
        if (!env($req)) {
            throw new RuntimeException("Missing setting $req. Add it to .env or your host's environment variables.");
        }
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        env('DB_HOST'),
        (int) env('DB_PORT', '3306'),
        env('DB_NAME')
    );
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 10,
    ];
    $ca = ca_file();
    if ($ca === null) {
        throw new RuntimeException('Aiven requires TLS. Set DB_SSL_CA (path to ca.pem) or DB_SSL_CA_PEM (its contents).');
    }
    $opts[PDO::MYSQL_ATTR_SSL_CA] = $ca;
    $opts[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = env('DB_SSL_VERIFY', 'true') !== 'false';

    $pdo = new PDO($dsn, env('DB_USER'), env('DB_PASS'), $opts);
    $pdo->exec("SET SESSION TRANSACTION READ ONLY");
    return $pdo;
}

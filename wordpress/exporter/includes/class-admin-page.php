<?php
namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Admin_Page {
    public static function init() {
        add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
        add_action( 'admin_post_mms_wp_starter_export', array( __CLASS__, 'handle_export' ) );
    }

    public static function register_menu() {
        add_management_page( 'خروجی‌گیر WP Starter', 'خروجی‌گیر WP Starter', 'manage_options', 'mms-wp-starter-exporter', array( __CLASS__, 'render' ) );
    }

    public static function render() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $exporter = new Exporter();
        $plugins  = $exporter->plugin_inventory();
        $snippets = $exporter->snippet_selection_inventory();
        $templates = $exporter->elementor_template_inventory();
        $roles    = $exporter->default_reading_roles();
        $role_options = array(
            ''        => 'تعیین نشود',
            'home'    => 'خانه',
            'about'   => 'درباره ما',
            'contact' => 'تماس با ما',
            'blog'    => 'وبلاگ',
        );
        ?>
        <div class="wrap" dir="rtl" style="direction:rtl;text-align:right;font-family:Tahoma,Arial,sans-serif">
            <h1>خروجی‌گیر WP Starter</h1>
            <p><strong>نسخه خروجی‌گیر <?php echo esc_html( MMS_WP_STARTER_EXPORTER_VERSION ); ?></strong></p>
            <p>این ابزار یک بسته پیکربندی قابل استفاده مجدد برای سایت‌های جدید می‌سازد. فهرست سایت مبدأ و بسته‌های مورد نیاز سایت مقصد عمداً جدا نگه داشته می‌شوند.</p>

            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                <input type="hidden" name="action" value="mms_wp_starter_export">
                <?php wp_nonce_field( 'mms_wp_starter_export' ); ?>

                <h2>بسته‌های آغازگر</h2>
                <p>انتخاب کنید کدام افزونه‌های سایت مبدأ در سایت‌های ساخته‌شده نصب شوند. فهرست کامل افزونه‌های مبدأ برای گزارش‌گیری ثبت می‌شود، اما افزونه‌های انتخاب‌نشده برای Builder الزامی نخواهند بود.</p>
                <div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:900px;max-height:330px;overflow:auto">
                    <?php if ( empty( $plugins ) ) : ?>
                        <p>هیچ افزونه‌ای پیدا نشد.</p>
                    <?php else : ?>
                        <?php foreach ( $plugins as $plugin ) : ?>
                            <label style="display:grid;grid-template-columns:24px minmax(220px,1fr) 120px 90px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f1">
                                <input type="checkbox" name="starter_plugins[]" value="<?php echo esc_attr( $plugin['file'] ); ?>" <?php checked( ! empty( $plugin['active'] ) ); ?>>
                                <span><strong><?php echo esc_html( $plugin['name'] ); ?></strong><br><code><?php echo esc_html( $plugin['file'] ); ?></code></span>
                                <span><?php echo esc_html( $plugin['version'] ); ?></span>
                                <span><?php echo ! empty( $plugin['active'] ) ? '<span style="color:#008a20">فعال</span>' : '<span style="color:#646970">غیرفعال</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                            </label>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>

                <h2 style="margin-top:28px">نقش صفحات وردپرس</h2>
                <p>این موارد نقش منطقی صفحه در سایت مقصد هستند، نه شناسه‌های پایگاه‌داده سایت مبدأ. Builder پس از ساخت صفحات آغازگر، آن‌ها را به‌صورت امن پیدا می‌کند.</p>
                <table class="form-table" role="presentation"><tbody>
                    <tr><th><label for="front_page_role">صفحه اصلی</label></th><td><select id="front_page_role" name="front_page_role">
                        <?php foreach ( $role_options as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $roles['front_page_role'], $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?>
                    </select></td></tr>
                    <tr><th><label for="posts_page_role">صفحه نوشته‌ها</label></th><td><select id="posts_page_role" name="posts_page_role">
                        <?php foreach ( $role_options as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $roles['posts_page_role'], $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?>
                    </select></td></tr>
                </tbody></table>

                <h2>قطعه‌کدها</h2>
                <p>فقط قطعه‌کدهای انتخاب‌شده صادر می‌شوند. قطعه‌کدهای فعال و غیرنمونه به‌صورت پیش‌فرض انتخاب شده‌اند؛ قطعه‌کدهای غیرفعال و نمونه‌های داخلی انتخاب نشده‌اند.</p>
                <div class="notice notice-warning inline"><p><strong>بررسی اطلاعات محرمانه:</strong> متن قطعه‌کد بدون تغییر صادر می‌شود. اگر قطعه‌کد انتخاب‌شده کلید API، توکن یا رمز عبور داشته باشد، آن اطلاعات نیز صادر خواهد شد.</p></div>
                <div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:900px;max-height:360px;overflow:auto">
                    <?php if ( empty( $snippets ) ) : ?>
                        <p>افزونه قطعه‌کدها در دسترس نیست یا قطعه‌کد قابل انتقالی ندارد.</p>
                    <?php else : ?>
                        <?php foreach ( $snippets as $snippet ) : ?>
                            <label style="display:grid;grid-template-columns:24px minmax(220px,1fr) 130px 120px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f1">
                                <input type="checkbox" name="starter_snippets[]" value="<?php echo esc_attr( $snippet['id'] ); ?>" <?php checked( ! empty( $snippet['default_selected'] ) ); ?>>
                                <span><strong><?php echo esc_html( $snippet['name'] ); ?></strong><?php echo ! empty( $snippet['sample'] ) ? ' <em style="color:#996800">نمونه</em>' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                <code><?php echo esc_html( $snippet['scope'] ); ?></code>
                                <span><?php echo ! empty( $snippet['active'] ) ? '<span style="color:#008a20">فعال</span>' : '<span style="color:#646970">غیرفعال</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                            </label>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>

                <h2 style="margin-top:28px">الگوهای ذخیره‌شده Elementor</h2>
                <p>فقط الگوهای انتخاب‌شده از بخش Saved Templates / Elementor Library صادر می‌شوند؛ برگه‌های معمولی که فقط با Elementor ساخته شده‌اند در این مرحله الگو محسوب نمی‌شوند. الگوها با شناسه منطقی ذخیره می‌شوند تا شناسه‌های اختصاصی سایت مبدأ به سایت مقصد منتقل نشوند. ارجاع‌های حل‌نشده هنگام راه‌اندازی با گزارش دقیق متوقف می‌شوند.</p>
                <div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:900px;max-height:330px;overflow:auto">
                    <?php if ( empty( $templates ) ) : ?>
                        <p>الگوی Elementor قابل انتقالی پیدا نشد. مطمئن شوید Elementor فعال است و الگوهای ذخیره‌شده دارای داده طراحی هستند.</p>
                    <?php else : ?>
                        <?php foreach ( $templates as $template ) : ?>
                            <label style="display:grid;grid-template-columns:24px minmax(220px,1fr) 140px 100px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f1">
                                <input type="checkbox" name="starter_elementor_templates[]" value="<?php echo esc_attr( $template['source_id'] ); ?>">
                                <span><strong><?php echo esc_html( $template['name'] ); ?></strong><br><code><?php echo esc_html( $template['id'] ); ?></code></span>
                                <span><?php echo esc_html( $template['type'] ); ?></span>
                                <span><?php echo 'publish' === $template['status'] ? 'منتشرشده' : ( 'private' === $template['status'] ? 'خصوصی' : 'پیش‌نویس' ); ?></span>
                            </label>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>

                <h2 style="margin-top:28px">سیاست پیکربندی قابل انتقال</h2>
                <ul style="list-style:disc;padding-left:22px">
                    <li><strong>وردپرس:</strong> مقادیر قابل استفاده مجدد، ساختار پیوند یکتا و نقش منطقی صفحات. هویت سایت، نشانی‌ها، ایمیل مدیر و شناسه خام صفحات منتقل نمی‌شوند.</li>
                    <li><strong>Elementor:</strong> تنظیمات ساختاری سایت شامل عرض محتوا، فاصله‌ها، نقاط شکست، انتخابگر عنوان صفحه، هدف بخش کشیده و الگوی پیش‌فرض صفحه.</li>
                    <li><strong>موارد حذف‌شده Elementor:</strong> هویت سایت، اتصال لایسنس، شرایط Theme Builder، CSS اختصاصی و فیلدهای ناشناخته کیت.</li>
                    <li><strong>WooCommerce:</strong> فقط تنظیمات موجود در فهرست مجاز بررسی‌شده منتقل می‌شوند.</li>
                    <li><strong>FilterX:</strong> تا زمان آماده‌شدن آداپتور remapping شناسه‌های اشیا، انتقال آن به تعویق افتاده است.</li>
                </ul>
                <p><button class="button button-primary button-hero" type="submit">دانلود پیکربندی آغازگر</button></p>
            </form>
        </div>
        <?php
    }

    public static function handle_export() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'شما اجازه انجام این کار را ندارید.' );
        }
        check_admin_referer( 'mms_wp_starter_export' );

        $selection = array(
            'starter_plugins'  => isset( $_POST['starter_plugins'] ) && is_array( $_POST['starter_plugins'] ) ? array_map( 'sanitize_text_field', wp_unslash( $_POST['starter_plugins'] ) ) : array(),
            'starter_snippets' => isset( $_POST['starter_snippets'] ) && is_array( $_POST['starter_snippets'] ) ? array_map( 'absint', $_POST['starter_snippets'] ) : array(),
            'starter_elementor_templates' => isset( $_POST['starter_elementor_templates'] ) && is_array( $_POST['starter_elementor_templates'] ) ? array_map( 'absint', $_POST['starter_elementor_templates'] ) : array(),
            'front_page_role'  => isset( $_POST['front_page_role'] ) ? sanitize_key( wp_unslash( $_POST['front_page_role'] ) ) : '',
            'posts_page_role'  => isset( $_POST['posts_page_role'] ) ? sanitize_key( wp_unslash( $_POST['posts_page_role'] ) ) : '',
        );

        $exporter = new Exporter();
        $config   = wp_json_encode( $exporter->build_config( $selection ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        $manifest = wp_json_encode( $exporter->build_manifest(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        if ( false === $config || false === $manifest ) {
            wp_die( 'تبدیل پیکربندی آغازگر به JSON ممکن نبود.' );
        }

        $tmp = trailingslashit( get_temp_dir() ) . 'wp-starter-export-' . wp_generate_password( 24, false, false );
        if ( ! wp_mkdir_p( $tmp ) ) {
            wp_die( 'ساخت پوشه موقت صادرات ممکن نبود.' );
        }
        @chmod( $tmp, 0700 );
        $config_path = $tmp . '/starter-config.json';
        $manifest_path = $tmp . '/export-manifest.json';
        if ( false === file_put_contents( $config_path, $config . "\n", LOCK_EX ) || false === file_put_contents( $manifest_path, $manifest . "\n", LOCK_EX ) ) {
            self::cleanup( $tmp ); wp_die( 'نوشتن فایل‌های موقت صادرات ممکن نبود.' );
        }
        @chmod( $config_path, 0600 ); @chmod( $manifest_path, 0600 );
        $zip_path = $tmp . '/starter-config.zip';
        if ( ! self::create_zip( $tmp, $zip_path ) || ! file_exists( $zip_path ) ) {
            self::cleanup( $tmp ); wp_die( 'ساخت فایل ZIP پیکربندی آغازگر ممکن نبود.' );
        }
        @chmod( $zip_path, 0600 );

        nocache_headers();
        header( 'Content-Type: application/zip' );
        header( 'Content-Disposition: attachment; filename="starter-config-' . gmdate( 'Ymd-His' ) . '.zip"' );
        header( 'Content-Length: ' . filesize( $zip_path ) );
        header( 'X-Content-Type-Options: nosniff' );
        header( 'Content-Security-Policy: default-src \'none\'; sandbox' );
        readfile( $zip_path );
        self::cleanup( $tmp );
        exit;
    }

    private static function create_zip( $source_dir, $zip_path ) {
        if ( class_exists( '\\ZipArchive' ) ) {
            $zip = new \ZipArchive();
            if ( true !== $zip->open( $zip_path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE ) ) return false;
            foreach ( array( 'starter-config.json', 'export-manifest.json' ) as $name ) {
                if ( ! $zip->addFile( $source_dir . '/' . $name, $name ) ) { $zip->close(); return false; }
            }
            return $zip->close();
        }
        require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
        $archive = new \PclZip( $zip_path );
        return 0 !== $archive->create( array( $source_dir . '/starter-config.json', $source_dir . '/export-manifest.json' ), PCLZIP_OPT_REMOVE_PATH, $source_dir );
    }

    private static function cleanup( $dir ) {
        if ( ! is_dir( $dir ) ) return;
        foreach ( scandir( $dir ) as $entry ) {
            if ( '.' === $entry || '..' === $entry ) continue;
            $path = $dir . '/' . $entry;
            if ( is_dir( $path ) && ! is_link( $path ) ) self::cleanup( $path ); else @unlink( $path );
        }
        @rmdir( $dir );
    }
}

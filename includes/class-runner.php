<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Runner {
    /**
     * Execute selected setup components.
     *
     * @param string   $profile_id Profile key.
     * @param string[] $components Selected components.
     * @return array[]
     */
    public function run( $profile_id, array $components ) {
        $profiles = Config::get( 'profiles', array() );

        if ( empty( $profiles[ $profile_id ] ) ) {
            return array(
                array(
                    'status'  => 'error',
                    'label'   => 'Setup',
                    'message' => 'Unknown starter profile.',
                ),
            );
        }

        $profile = $profiles[ $profile_id ];
        $results = array();

        if ( in_array( 'theme', $components, true ) ) {
            $manager = new Theme_Manager();
            $results = array_merge( $results, $manager->ensure_theme() );
        }

        if ( in_array( 'plugins', $components, true ) ) {
            $manager = new Plugin_Manager();
            $results = array_merge( $results, $manager->ensure_plugins( $profile['plugins'] ) );
        }

        if ( in_array( 'wordpress', $components, true ) ) {
            $manager = new Settings_Manager();
            $results = array_merge( $results, $manager->apply_wordpress_defaults() );
        }

        if ( in_array( 'plugin-settings', $components, true ) ) {
            $manager = new Plugin_Settings_Manager();
            $results = array_merge( $results, $manager->apply_defaults() );
        }

        if ( in_array( 'cleanup', $components, true ) ) {
            $manager = new Settings_Manager();
            $results = array_merge( $results, $manager->clean_default_content() );
        }

        if ( in_array( 'pages', $components, true ) ) {
            $manager = new Page_Manager();
            $results = array_merge( $results, $manager->apply( $profile ) );
        }

        if ( in_array( 'elementor', $components, true ) ) {
            $manager = new Elementor_Manager();
            $results = array_merge( $results, $manager->apply_defaults() );
        }

        update_option(
            'mss_last_setup_run',
            array(
                'version'    => MSS_VERSION,
                'profile'    => $profile_id,
                'components' => array_values( $components ),
                'timestamp'  => time(),
            ),
            false
        );

        return $results;
    }
}
